// Copyright 2018-2021 the Deno authors. All rights reserved. MIT license.
import { BufReader, BufWriter } from "../io/bufio.ts";
import { assert } from "../_util/assert.ts";
import { deferred, MuxAsyncIterator } from "../async/mod.ts";
import { bodyReader, chunkedBodyReader, emptyReader, readRequest, writeResponse } from "./_io.ts";
export class ServerRequest {
    url;
    method;
    proto;
    protoMinor;
    protoMajor;
    headers;
    conn;
    r;
    w;
    #done = deferred();
    #contentLength = undefined;
    #body = undefined;
    #finalized = false;
    get done() {
        return this.#done.then((e)=>e
        );
    }
    /**
   * Value of Content-Length header.
   * If null, then content length is invalid or not given (e.g. chunked encoding).
   */ get contentLength() {
        // undefined means not cached.
        // null means invalid or not provided.
        if (this.#contentLength === undefined) {
            const cl = this.headers.get("content-length");
            if (cl) {
                this.#contentLength = parseInt(cl);
                // Convert NaN to null (as NaN harder to test)
                if (Number.isNaN(this.#contentLength)) {
                    this.#contentLength = null;
                }
            } else {
                this.#contentLength = null;
            }
        }
        return this.#contentLength;
    }
    /**
   * Body of the request.  The easiest way to consume the body is:
   *
   *     const buf: Uint8Array = await readAll(req.body);
   */ get body() {
        if (!this.#body) {
            if (this.contentLength != null) {
                this.#body = bodyReader(this.contentLength, this.r);
            } else {
                const transferEncoding = this.headers.get("transfer-encoding");
                if (transferEncoding != null) {
                    const parts = transferEncoding.split(",").map((e)=>e.trim().toLowerCase()
                    );
                    assert(parts.includes("chunked"), 'transfer-encoding must include "chunked" if content-length is not set');
                    this.#body = chunkedBodyReader(this.headers, this.r);
                } else {
                    // Neither content-length nor transfer-encoding: chunked
                    this.#body = emptyReader();
                }
            }
        }
        return this.#body;
    }
    async respond(r) {
        let err;
        try {
            // Write our response!
            await writeResponse(this.w, r);
        } catch (e) {
            try {
                // Eagerly close on error.
                this.conn.close();
            } catch  {
            // Pass
            }
            err = e;
        }
        // Signal that this request has been processed and the next pipelined
        // request on the same connection can be accepted.
        this.#done.resolve(err);
        if (err) {
            // Error during responding, rethrow.
            throw err;
        }
    }
    async finalize() {
        if (this.#finalized) return;
        // Consume unread body
        const body = this.body;
        const buf = new Uint8Array(1024);
        while(await body.read(buf) !== null){
        // Pass
        }
        this.#finalized = true;
    }
}
export class Server {
    listener;
    #closing = false;
    #connections = [];
    constructor(listener){
        this.listener = listener;
    }
    close() {
        this.#closing = true;
        this.listener.close();
        for (const conn of this.#connections){
            try {
                conn.close();
            } catch (e) {
                // Connection might have been already closed
                if (!(e instanceof Deno.errors.BadResource)) {
                    throw e;
                }
            }
        }
    }
    // Yields all HTTP requests on a single TCP connection.
    async *iterateHttpRequests(conn) {
        const reader = new BufReader(conn);
        const writer = new BufWriter(conn);
        while(!this.#closing){
            let request;
            try {
                request = await readRequest(conn, reader);
            } catch (error) {
                if (error instanceof Deno.errors.InvalidData || error instanceof Deno.errors.UnexpectedEof) {
                    // An error was thrown while parsing request headers.
                    // Try to send the "400 Bad Request" before closing the connection.
                    try {
                        await writeResponse(writer, {
                            status: 400,
                            body: new TextEncoder().encode(`${error.message}\r\n\r\n`)
                        });
                    } catch  {
                    // The connection is broken.
                    }
                }
                break;
            }
            if (request === null) {
                break;
            }
            request.w = writer;
            yield request;
            // Wait for the request to be processed before we accept a new request on
            // this connection.
            const responseError = await request.done;
            if (responseError) {
                // Something bad happened during response.
                // (likely other side closed during pipelined req)
                // req.done implies this connection already closed, so we can just return.
                this.untrackConnection(request.conn);
                return;
            }
            try {
                // Consume unread body and trailers if receiver didn't consume those data
                await request.finalize();
            } catch  {
                break;
            }
        }
        this.untrackConnection(conn);
        try {
            conn.close();
        } catch  {
        // might have been already closed
        }
    }
    trackConnection(conn) {
        this.#connections.push(conn);
    }
    untrackConnection(conn) {
        const index = this.#connections.indexOf(conn);
        if (index !== -1) {
            this.#connections.splice(index, 1);
        }
    }
    // Accepts a new TCP connection and yields all HTTP requests that arrive on
    // it. When a connection is accepted, it also creates a new iterator of the
    // same kind and adds it to the request multiplexer so that another TCP
    // connection can be accepted.
    async *acceptConnAndIterateHttpRequests(mux) {
        if (this.#closing) return;
        // Wait for a new connection.
        let conn;
        try {
            conn = await this.listener.accept();
        } catch (error) {
            if (// The listener is closed:
            error instanceof Deno.errors.BadResource || // TLS handshake errors:
            error instanceof Deno.errors.InvalidData || error instanceof Deno.errors.UnexpectedEof || error instanceof Deno.errors.ConnectionReset) {
                return mux.add(this.acceptConnAndIterateHttpRequests(mux));
            }
            throw error;
        }
        this.trackConnection(conn);
        // Try to accept another connection and add it to the multiplexer.
        mux.add(this.acceptConnAndIterateHttpRequests(mux));
        // Yield the requests that arrive on the just-accepted connection.
        yield* this.iterateHttpRequests(conn);
    }
    [Symbol.asyncIterator]() {
        const mux = new MuxAsyncIterator();
        mux.add(this.acceptConnAndIterateHttpRequests(mux));
        return mux.iterate();
    }
}
/**
 * Parse addr from string
 *
 *     const addr = "::1:8000";
 *     parseAddrFromString(addr);
 *
 * @param addr Address string
 */ export function _parseAddrFromStr(addr) {
    let url;
    try {
        const host = addr.startsWith(":") ? `0.0.0.0${addr}` : addr;
        url = new URL(`http://${host}`);
    } catch  {
        throw new TypeError("Invalid address.");
    }
    if (url.username || url.password || url.pathname != "/" || url.search || url.hash) {
        throw new TypeError("Invalid address.");
    }
    return {
        hostname: url.hostname,
        port: url.port === "" ? 80 : Number(url.port)
    };
}
/**
 * Create a HTTP server
 *
 *     import { serve } from "https://deno.land/std/http/server.ts";
 *     const body = "Hello World\n";
 *     const server = serve({ port: 8000 });
 *     for await (const req of server) {
 *       req.respond({ body });
 *     }
 */ export function serve(addr) {
    if (typeof addr === "string") {
        addr = _parseAddrFromStr(addr);
    }
    const listener = Deno.listen(addr);
    return new Server(listener);
}
/**
 * Start an HTTP server with given options and request handler
 *
 *     const body = "Hello World\n";
 *     const options = { port: 8000 };
 *     listenAndServe(options, (req) => {
 *       req.respond({ body });
 *     });
 *
 * @param options Server configuration
 * @param handler Request handler
 */ export async function listenAndServe(addr, handler) {
    const server = serve(addr);
    for await (const request of server){
        handler(request);
    }
}
/**
 * Create an HTTPS server with given options
 *
 *     const body = "Hello HTTPS";
 *     const options = {
 *       hostname: "localhost",
 *       port: 443,
 *       certFile: "./path/to/localhost.crt",
 *       keyFile: "./path/to/localhost.key",
 *     };
 *     for await (const req of serveTLS(options)) {
 *       req.respond({ body });
 *     }
 *
 * @param options Server configuration
 * @return Async iterable server instance for incoming requests
 */ export function serveTLS(options) {
    const tlsOptions = {
        ...options,
        transport: "tcp"
    };
    const listener = Deno.listenTls(tlsOptions);
    return new Server(listener);
}
/**
 * Start an HTTPS server with given options and request handler
 *
 *     const body = "Hello HTTPS";
 *     const options = {
 *       hostname: "localhost",
 *       port: 443,
 *       certFile: "./path/to/localhost.crt",
 *       keyFile: "./path/to/localhost.key",
 *     };
 *     listenAndServeTLS(options, (req) => {
 *       req.respond({ body });
 *     });
 *
 * @param options Server configuration
 * @param handler Request handler
 */ export async function listenAndServeTLS(options, handler) {
    const server = serveTLS(options);
    for await (const request of server){
        handler(request);
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbImh0dHBzOi8vZGVuby5sYW5kL3N0ZEAwLjk5LjAvaHR0cC9zZXJ2ZXIudHMiXSwic291cmNlc0NvbnRlbnQiOlsiLy8gQ29weXJpZ2h0IDIwMTgtMjAyMSB0aGUgRGVubyBhdXRob3JzLiBBbGwgcmlnaHRzIHJlc2VydmVkLiBNSVQgbGljZW5zZS5cbmltcG9ydCB7IEJ1ZlJlYWRlciwgQnVmV3JpdGVyIH0gZnJvbSBcIi4uL2lvL2J1ZmlvLnRzXCI7XG5pbXBvcnQgeyBhc3NlcnQgfSBmcm9tIFwiLi4vX3V0aWwvYXNzZXJ0LnRzXCI7XG5pbXBvcnQgeyBEZWZlcnJlZCwgZGVmZXJyZWQsIE11eEFzeW5jSXRlcmF0b3IgfSBmcm9tIFwiLi4vYXN5bmMvbW9kLnRzXCI7XG5pbXBvcnQge1xuICBib2R5UmVhZGVyLFxuICBjaHVua2VkQm9keVJlYWRlcixcbiAgZW1wdHlSZWFkZXIsXG4gIHJlYWRSZXF1ZXN0LFxuICB3cml0ZVJlc3BvbnNlLFxufSBmcm9tIFwiLi9faW8udHNcIjtcbmV4cG9ydCBjbGFzcyBTZXJ2ZXJSZXF1ZXN0IHtcbiAgdXJsITogc3RyaW5nO1xuICBtZXRob2QhOiBzdHJpbmc7XG4gIHByb3RvITogc3RyaW5nO1xuICBwcm90b01pbm9yITogbnVtYmVyO1xuICBwcm90b01ham9yITogbnVtYmVyO1xuICBoZWFkZXJzITogSGVhZGVycztcbiAgY29ubiE6IERlbm8uQ29ubjtcbiAgciE6IEJ1ZlJlYWRlcjtcbiAgdyE6IEJ1ZldyaXRlcjtcblxuICAjZG9uZTogRGVmZXJyZWQ8RXJyb3IgfCB1bmRlZmluZWQ+ID0gZGVmZXJyZWQoKTtcbiAgI2NvbnRlbnRMZW5ndGg/OiBudW1iZXIgfCBudWxsID0gdW5kZWZpbmVkO1xuICAjYm9keT86IERlbm8uUmVhZGVyID0gdW5kZWZpbmVkO1xuICAjZmluYWxpemVkID0gZmFsc2U7XG5cbiAgZ2V0IGRvbmUoKTogUHJvbWlzZTxFcnJvciB8IHVuZGVmaW5lZD4ge1xuICAgIHJldHVybiB0aGlzLiNkb25lLnRoZW4oKGUpID0+IGUpO1xuICB9XG5cbiAgLyoqXG4gICAqIFZhbHVlIG9mIENvbnRlbnQtTGVuZ3RoIGhlYWRlci5cbiAgICogSWYgbnVsbCwgdGhlbiBjb250ZW50IGxlbmd0aCBpcyBpbnZhbGlkIG9yIG5vdCBnaXZlbiAoZS5nLiBjaHVua2VkIGVuY29kaW5nKS5cbiAgICovXG4gIGdldCBjb250ZW50TGVuZ3RoKCk6IG51bWJlciB8IG51bGwge1xuICAgIC8vIHVuZGVmaW5lZCBtZWFucyBub3QgY2FjaGVkLlxuICAgIC8vIG51bGwgbWVhbnMgaW52YWxpZCBvciBub3QgcHJvdmlkZWQuXG4gICAgaWYgKHRoaXMuI2NvbnRlbnRMZW5ndGggPT09IHVuZGVmaW5lZCkge1xuICAgICAgY29uc3QgY2wgPSB0aGlzLmhlYWRlcnMuZ2V0KFwiY29udGVudC1sZW5ndGhcIik7XG4gICAgICBpZiAoY2wpIHtcbiAgICAgICAgdGhpcy4jY29udGVudExlbmd0aCA9IHBhcnNlSW50KGNsKTtcbiAgICAgICAgLy8gQ29udmVydCBOYU4gdG8gbnVsbCAoYXMgTmFOIGhhcmRlciB0byB0ZXN0KVxuICAgICAgICBpZiAoTnVtYmVyLmlzTmFOKHRoaXMuI2NvbnRlbnRMZW5ndGgpKSB7XG4gICAgICAgICAgdGhpcy4jY29udGVudExlbmd0aCA9IG51bGw7XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRoaXMuI2NvbnRlbnRMZW5ndGggPSBudWxsO1xuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gdGhpcy4jY29udGVudExlbmd0aDtcbiAgfVxuXG4gIC8qKlxuICAgKiBCb2R5IG9mIHRoZSByZXF1ZXN0LiAgVGhlIGVhc2llc3Qgd2F5IHRvIGNvbnN1bWUgdGhlIGJvZHkgaXM6XG4gICAqXG4gICAqICAgICBjb25zdCBidWY6IFVpbnQ4QXJyYXkgPSBhd2FpdCByZWFkQWxsKHJlcS5ib2R5KTtcbiAgICovXG4gIGdldCBib2R5KCk6IERlbm8uUmVhZGVyIHtcbiAgICBpZiAoIXRoaXMuI2JvZHkpIHtcbiAgICAgIGlmICh0aGlzLmNvbnRlbnRMZW5ndGggIT0gbnVsbCkge1xuICAgICAgICB0aGlzLiNib2R5ID0gYm9keVJlYWRlcih0aGlzLmNvbnRlbnRMZW5ndGgsIHRoaXMucik7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBjb25zdCB0cmFuc2ZlckVuY29kaW5nID0gdGhpcy5oZWFkZXJzLmdldChcInRyYW5zZmVyLWVuY29kaW5nXCIpO1xuICAgICAgICBpZiAodHJhbnNmZXJFbmNvZGluZyAhPSBudWxsKSB7XG4gICAgICAgICAgY29uc3QgcGFydHMgPSB0cmFuc2ZlckVuY29kaW5nXG4gICAgICAgICAgICAuc3BsaXQoXCIsXCIpXG4gICAgICAgICAgICAubWFwKChlKTogc3RyaW5nID0+IGUudHJpbSgpLnRvTG93ZXJDYXNlKCkpO1xuICAgICAgICAgIGFzc2VydChcbiAgICAgICAgICAgIHBhcnRzLmluY2x1ZGVzKFwiY2h1bmtlZFwiKSxcbiAgICAgICAgICAgICd0cmFuc2Zlci1lbmNvZGluZyBtdXN0IGluY2x1ZGUgXCJjaHVua2VkXCIgaWYgY29udGVudC1sZW5ndGggaXMgbm90IHNldCcsXG4gICAgICAgICAgKTtcbiAgICAgICAgICB0aGlzLiNib2R5ID0gY2h1bmtlZEJvZHlSZWFkZXIodGhpcy5oZWFkZXJzLCB0aGlzLnIpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIC8vIE5laXRoZXIgY29udGVudC1sZW5ndGggbm9yIHRyYW5zZmVyLWVuY29kaW5nOiBjaHVua2VkXG4gICAgICAgICAgdGhpcy4jYm9keSA9IGVtcHR5UmVhZGVyKCk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIHRoaXMuI2JvZHk7XG4gIH1cblxuICBhc3luYyByZXNwb25kKHI6IFJlc3BvbnNlKSB7XG4gICAgbGV0IGVycjogRXJyb3IgfCB1bmRlZmluZWQ7XG4gICAgdHJ5IHtcbiAgICAgIC8vIFdyaXRlIG91ciByZXNwb25zZSFcbiAgICAgIGF3YWl0IHdyaXRlUmVzcG9uc2UodGhpcy53LCByKTtcbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICB0cnkge1xuICAgICAgICAvLyBFYWdlcmx5IGNsb3NlIG9uIGVycm9yLlxuICAgICAgICB0aGlzLmNvbm4uY2xvc2UoKTtcbiAgICAgIH0gY2F0Y2gge1xuICAgICAgICAvLyBQYXNzXG4gICAgICB9XG4gICAgICBlcnIgPSBlO1xuICAgIH1cbiAgICAvLyBTaWduYWwgdGhhdCB0aGlzIHJlcXVlc3QgaGFzIGJlZW4gcHJvY2Vzc2VkIGFuZCB0aGUgbmV4dCBwaXBlbGluZWRcbiAgICAvLyByZXF1ZXN0IG9uIHRoZSBzYW1lIGNvbm5lY3Rpb24gY2FuIGJlIGFjY2VwdGVkLlxuICAgIHRoaXMuI2RvbmUucmVzb2x2ZShlcnIpO1xuICAgIGlmIChlcnIpIHtcbiAgICAgIC8vIEVycm9yIGR1cmluZyByZXNwb25kaW5nLCByZXRocm93LlxuICAgICAgdGhyb3cgZXJyO1xuICAgIH1cbiAgfVxuXG4gIGFzeW5jIGZpbmFsaXplKCkge1xuICAgIGlmICh0aGlzLiNmaW5hbGl6ZWQpIHJldHVybjtcbiAgICAvLyBDb25zdW1lIHVucmVhZCBib2R5XG4gICAgY29uc3QgYm9keSA9IHRoaXMuYm9keTtcbiAgICBjb25zdCBidWYgPSBuZXcgVWludDhBcnJheSgxMDI0KTtcbiAgICB3aGlsZSAoKGF3YWl0IGJvZHkucmVhZChidWYpKSAhPT0gbnVsbCkge1xuICAgICAgLy8gUGFzc1xuICAgIH1cbiAgICB0aGlzLiNmaW5hbGl6ZWQgPSB0cnVlO1xuICB9XG59XG5cbmV4cG9ydCBjbGFzcyBTZXJ2ZXIgaW1wbGVtZW50cyBBc3luY0l0ZXJhYmxlPFNlcnZlclJlcXVlc3Q+IHtcbiAgI2Nsb3NpbmcgPSBmYWxzZTtcbiAgI2Nvbm5lY3Rpb25zOiBEZW5vLkNvbm5bXSA9IFtdO1xuXG4gIGNvbnN0cnVjdG9yKHB1YmxpYyBsaXN0ZW5lcjogRGVuby5MaXN0ZW5lcikge31cblxuICBjbG9zZSgpOiB2b2lkIHtcbiAgICB0aGlzLiNjbG9zaW5nID0gdHJ1ZTtcbiAgICB0aGlzLmxpc3RlbmVyLmNsb3NlKCk7XG4gICAgZm9yIChjb25zdCBjb25uIG9mIHRoaXMuI2Nvbm5lY3Rpb25zKSB7XG4gICAgICB0cnkge1xuICAgICAgICBjb25uLmNsb3NlKCk7XG4gICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgIC8vIENvbm5lY3Rpb24gbWlnaHQgaGF2ZSBiZWVuIGFscmVhZHkgY2xvc2VkXG4gICAgICAgIGlmICghKGUgaW5zdGFuY2VvZiBEZW5vLmVycm9ycy5CYWRSZXNvdXJjZSkpIHtcbiAgICAgICAgICB0aHJvdyBlO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLy8gWWllbGRzIGFsbCBIVFRQIHJlcXVlc3RzIG9uIGEgc2luZ2xlIFRDUCBjb25uZWN0aW9uLlxuICBwcml2YXRlIGFzeW5jICppdGVyYXRlSHR0cFJlcXVlc3RzKFxuICAgIGNvbm46IERlbm8uQ29ubixcbiAgKTogQXN5bmNJdGVyYWJsZUl0ZXJhdG9yPFNlcnZlclJlcXVlc3Q+IHtcbiAgICBjb25zdCByZWFkZXIgPSBuZXcgQnVmUmVhZGVyKGNvbm4pO1xuICAgIGNvbnN0IHdyaXRlciA9IG5ldyBCdWZXcml0ZXIoY29ubik7XG5cbiAgICB3aGlsZSAoIXRoaXMuI2Nsb3NpbmcpIHtcbiAgICAgIGxldCByZXF1ZXN0OiBTZXJ2ZXJSZXF1ZXN0IHwgbnVsbDtcbiAgICAgIHRyeSB7XG4gICAgICAgIHJlcXVlc3QgPSBhd2FpdCByZWFkUmVxdWVzdChjb25uLCByZWFkZXIpO1xuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgaWYgKFxuICAgICAgICAgIGVycm9yIGluc3RhbmNlb2YgRGVuby5lcnJvcnMuSW52YWxpZERhdGEgfHxcbiAgICAgICAgICBlcnJvciBpbnN0YW5jZW9mIERlbm8uZXJyb3JzLlVuZXhwZWN0ZWRFb2ZcbiAgICAgICAgKSB7XG4gICAgICAgICAgLy8gQW4gZXJyb3Igd2FzIHRocm93biB3aGlsZSBwYXJzaW5nIHJlcXVlc3QgaGVhZGVycy5cbiAgICAgICAgICAvLyBUcnkgdG8gc2VuZCB0aGUgXCI0MDAgQmFkIFJlcXVlc3RcIiBiZWZvcmUgY2xvc2luZyB0aGUgY29ubmVjdGlvbi5cbiAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgYXdhaXQgd3JpdGVSZXNwb25zZSh3cml0ZXIsIHtcbiAgICAgICAgICAgICAgc3RhdHVzOiA0MDAsXG4gICAgICAgICAgICAgIGJvZHk6IG5ldyBUZXh0RW5jb2RlcigpLmVuY29kZShgJHtlcnJvci5tZXNzYWdlfVxcclxcblxcclxcbmApLFxuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgfSBjYXRjaCB7XG4gICAgICAgICAgICAvLyBUaGUgY29ubmVjdGlvbiBpcyBicm9rZW4uXG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIGJyZWFrO1xuICAgICAgfVxuICAgICAgaWYgKHJlcXVlc3QgPT09IG51bGwpIHtcbiAgICAgICAgYnJlYWs7XG4gICAgICB9XG5cbiAgICAgIHJlcXVlc3QudyA9IHdyaXRlcjtcbiAgICAgIHlpZWxkIHJlcXVlc3Q7XG5cbiAgICAgIC8vIFdhaXQgZm9yIHRoZSByZXF1ZXN0IHRvIGJlIHByb2Nlc3NlZCBiZWZvcmUgd2UgYWNjZXB0IGEgbmV3IHJlcXVlc3Qgb25cbiAgICAgIC8vIHRoaXMgY29ubmVjdGlvbi5cbiAgICAgIGNvbnN0IHJlc3BvbnNlRXJyb3IgPSBhd2FpdCByZXF1ZXN0LmRvbmU7XG4gICAgICBpZiAocmVzcG9uc2VFcnJvcikge1xuICAgICAgICAvLyBTb21ldGhpbmcgYmFkIGhhcHBlbmVkIGR1cmluZyByZXNwb25zZS5cbiAgICAgICAgLy8gKGxpa2VseSBvdGhlciBzaWRlIGNsb3NlZCBkdXJpbmcgcGlwZWxpbmVkIHJlcSlcbiAgICAgICAgLy8gcmVxLmRvbmUgaW1wbGllcyB0aGlzIGNvbm5lY3Rpb24gYWxyZWFkeSBjbG9zZWQsIHNvIHdlIGNhbiBqdXN0IHJldHVybi5cbiAgICAgICAgdGhpcy51bnRyYWNrQ29ubmVjdGlvbihyZXF1ZXN0LmNvbm4pO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG5cbiAgICAgIHRyeSB7XG4gICAgICAgIC8vIENvbnN1bWUgdW5yZWFkIGJvZHkgYW5kIHRyYWlsZXJzIGlmIHJlY2VpdmVyIGRpZG4ndCBjb25zdW1lIHRob3NlIGRhdGFcbiAgICAgICAgYXdhaXQgcmVxdWVzdC5maW5hbGl6ZSgpO1xuICAgICAgfSBjYXRjaCB7XG4gICAgICAgIC8vIEludmFsaWQgZGF0YSB3YXMgcmVjZWl2ZWQgb3IgdGhlIGNvbm5lY3Rpb24gd2FzIGNsb3NlZC5cbiAgICAgICAgYnJlYWs7XG4gICAgICB9XG4gICAgfVxuXG4gICAgdGhpcy51bnRyYWNrQ29ubmVjdGlvbihjb25uKTtcbiAgICB0cnkge1xuICAgICAgY29ubi5jbG9zZSgpO1xuICAgIH0gY2F0Y2gge1xuICAgICAgLy8gbWlnaHQgaGF2ZSBiZWVuIGFscmVhZHkgY2xvc2VkXG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSB0cmFja0Nvbm5lY3Rpb24oY29ubjogRGVuby5Db25uKTogdm9pZCB7XG4gICAgdGhpcy4jY29ubmVjdGlvbnMucHVzaChjb25uKTtcbiAgfVxuXG4gIHByaXZhdGUgdW50cmFja0Nvbm5lY3Rpb24oY29ubjogRGVuby5Db25uKTogdm9pZCB7XG4gICAgY29uc3QgaW5kZXggPSB0aGlzLiNjb25uZWN0aW9ucy5pbmRleE9mKGNvbm4pO1xuICAgIGlmIChpbmRleCAhPT0gLTEpIHtcbiAgICAgIHRoaXMuI2Nvbm5lY3Rpb25zLnNwbGljZShpbmRleCwgMSk7XG4gICAgfVxuICB9XG5cbiAgLy8gQWNjZXB0cyBhIG5ldyBUQ1AgY29ubmVjdGlvbiBhbmQgeWllbGRzIGFsbCBIVFRQIHJlcXVlc3RzIHRoYXQgYXJyaXZlIG9uXG4gIC8vIGl0LiBXaGVuIGEgY29ubmVjdGlvbiBpcyBhY2NlcHRlZCwgaXQgYWxzbyBjcmVhdGVzIGEgbmV3IGl0ZXJhdG9yIG9mIHRoZVxuICAvLyBzYW1lIGtpbmQgYW5kIGFkZHMgaXQgdG8gdGhlIHJlcXVlc3QgbXVsdGlwbGV4ZXIgc28gdGhhdCBhbm90aGVyIFRDUFxuICAvLyBjb25uZWN0aW9uIGNhbiBiZSBhY2NlcHRlZC5cbiAgcHJpdmF0ZSBhc3luYyAqYWNjZXB0Q29ubkFuZEl0ZXJhdGVIdHRwUmVxdWVzdHMoXG4gICAgbXV4OiBNdXhBc3luY0l0ZXJhdG9yPFNlcnZlclJlcXVlc3Q+LFxuICApOiBBc3luY0l0ZXJhYmxlSXRlcmF0b3I8U2VydmVyUmVxdWVzdD4ge1xuICAgIGlmICh0aGlzLiNjbG9zaW5nKSByZXR1cm47XG4gICAgLy8gV2FpdCBmb3IgYSBuZXcgY29ubmVjdGlvbi5cbiAgICBsZXQgY29ubjogRGVuby5Db25uO1xuICAgIHRyeSB7XG4gICAgICBjb25uID0gYXdhaXQgdGhpcy5saXN0ZW5lci5hY2NlcHQoKTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgaWYgKFxuICAgICAgICAvLyBUaGUgbGlzdGVuZXIgaXMgY2xvc2VkOlxuICAgICAgICBlcnJvciBpbnN0YW5jZW9mIERlbm8uZXJyb3JzLkJhZFJlc291cmNlIHx8XG4gICAgICAgIC8vIFRMUyBoYW5kc2hha2UgZXJyb3JzOlxuICAgICAgICBlcnJvciBpbnN0YW5jZW9mIERlbm8uZXJyb3JzLkludmFsaWREYXRhIHx8XG4gICAgICAgIGVycm9yIGluc3RhbmNlb2YgRGVuby5lcnJvcnMuVW5leHBlY3RlZEVvZiB8fFxuICAgICAgICBlcnJvciBpbnN0YW5jZW9mIERlbm8uZXJyb3JzLkNvbm5lY3Rpb25SZXNldFxuICAgICAgKSB7XG4gICAgICAgIHJldHVybiBtdXguYWRkKHRoaXMuYWNjZXB0Q29ubkFuZEl0ZXJhdGVIdHRwUmVxdWVzdHMobXV4KSk7XG4gICAgICB9XG4gICAgICB0aHJvdyBlcnJvcjtcbiAgICB9XG4gICAgdGhpcy50cmFja0Nvbm5lY3Rpb24oY29ubik7XG4gICAgLy8gVHJ5IHRvIGFjY2VwdCBhbm90aGVyIGNvbm5lY3Rpb24gYW5kIGFkZCBpdCB0byB0aGUgbXVsdGlwbGV4ZXIuXG4gICAgbXV4LmFkZCh0aGlzLmFjY2VwdENvbm5BbmRJdGVyYXRlSHR0cFJlcXVlc3RzKG11eCkpO1xuICAgIC8vIFlpZWxkIHRoZSByZXF1ZXN0cyB0aGF0IGFycml2ZSBvbiB0aGUganVzdC1hY2NlcHRlZCBjb25uZWN0aW9uLlxuICAgIHlpZWxkKiB0aGlzLml0ZXJhdGVIdHRwUmVxdWVzdHMoY29ubik7XG4gIH1cblxuICBbU3ltYm9sLmFzeW5jSXRlcmF0b3JdKCk6IEFzeW5jSXRlcmFibGVJdGVyYXRvcjxTZXJ2ZXJSZXF1ZXN0PiB7XG4gICAgY29uc3QgbXV4OiBNdXhBc3luY0l0ZXJhdG9yPFNlcnZlclJlcXVlc3Q+ID0gbmV3IE11eEFzeW5jSXRlcmF0b3IoKTtcbiAgICBtdXguYWRkKHRoaXMuYWNjZXB0Q29ubkFuZEl0ZXJhdGVIdHRwUmVxdWVzdHMobXV4KSk7XG4gICAgcmV0dXJuIG11eC5pdGVyYXRlKCk7XG4gIH1cbn1cblxuLyoqIE9wdGlvbnMgZm9yIGNyZWF0aW5nIGFuIEhUVFAgc2VydmVyLiAqL1xuZXhwb3J0IHR5cGUgSFRUUE9wdGlvbnMgPSBPbWl0PERlbm8uTGlzdGVuT3B0aW9ucywgXCJ0cmFuc3BvcnRcIj47XG5cbi8qKlxuICogUGFyc2UgYWRkciBmcm9tIHN0cmluZ1xuICpcbiAqICAgICBjb25zdCBhZGRyID0gXCI6OjE6ODAwMFwiO1xuICogICAgIHBhcnNlQWRkckZyb21TdHJpbmcoYWRkcik7XG4gKlxuICogQHBhcmFtIGFkZHIgQWRkcmVzcyBzdHJpbmdcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIF9wYXJzZUFkZHJGcm9tU3RyKGFkZHI6IHN0cmluZyk6IEhUVFBPcHRpb25zIHtcbiAgbGV0IHVybDogVVJMO1xuICB0cnkge1xuICAgIGNvbnN0IGhvc3QgPSBhZGRyLnN0YXJ0c1dpdGgoXCI6XCIpID8gYDAuMC4wLjAke2FkZHJ9YCA6IGFkZHI7XG4gICAgdXJsID0gbmV3IFVSTChgaHR0cDovLyR7aG9zdH1gKTtcbiAgfSBjYXRjaCB7XG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvcihcIkludmFsaWQgYWRkcmVzcy5cIik7XG4gIH1cbiAgaWYgKFxuICAgIHVybC51c2VybmFtZSB8fFxuICAgIHVybC5wYXNzd29yZCB8fFxuICAgIHVybC5wYXRobmFtZSAhPSBcIi9cIiB8fFxuICAgIHVybC5zZWFyY2ggfHxcbiAgICB1cmwuaGFzaFxuICApIHtcbiAgICB0aHJvdyBuZXcgVHlwZUVycm9yKFwiSW52YWxpZCBhZGRyZXNzLlwiKTtcbiAgfVxuXG4gIHJldHVybiB7XG4gICAgaG9zdG5hbWU6IHVybC5ob3N0bmFtZSxcbiAgICBwb3J0OiB1cmwucG9ydCA9PT0gXCJcIiA/IDgwIDogTnVtYmVyKHVybC5wb3J0KSxcbiAgfTtcbn1cblxuLyoqXG4gKiBDcmVhdGUgYSBIVFRQIHNlcnZlclxuICpcbiAqICAgICBpbXBvcnQgeyBzZXJ2ZSB9IGZyb20gXCJodHRwczovL2Rlbm8ubGFuZC9zdGQvaHR0cC9zZXJ2ZXIudHNcIjtcbiAqICAgICBjb25zdCBib2R5ID0gXCJIZWxsbyBXb3JsZFxcblwiO1xuICogICAgIGNvbnN0IHNlcnZlciA9IHNlcnZlKHsgcG9ydDogODAwMCB9KTtcbiAqICAgICBmb3IgYXdhaXQgKGNvbnN0IHJlcSBvZiBzZXJ2ZXIpIHtcbiAqICAgICAgIHJlcS5yZXNwb25kKHsgYm9keSB9KTtcbiAqICAgICB9XG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzZXJ2ZShhZGRyOiBzdHJpbmcgfCBIVFRQT3B0aW9ucyk6IFNlcnZlciB7XG4gIGlmICh0eXBlb2YgYWRkciA9PT0gXCJzdHJpbmdcIikge1xuICAgIGFkZHIgPSBfcGFyc2VBZGRyRnJvbVN0cihhZGRyKTtcbiAgfVxuXG4gIGNvbnN0IGxpc3RlbmVyID0gRGVuby5saXN0ZW4oYWRkcik7XG4gIHJldHVybiBuZXcgU2VydmVyKGxpc3RlbmVyKTtcbn1cblxuLyoqXG4gKiBTdGFydCBhbiBIVFRQIHNlcnZlciB3aXRoIGdpdmVuIG9wdGlvbnMgYW5kIHJlcXVlc3QgaGFuZGxlclxuICpcbiAqICAgICBjb25zdCBib2R5ID0gXCJIZWxsbyBXb3JsZFxcblwiO1xuICogICAgIGNvbnN0IG9wdGlvbnMgPSB7IHBvcnQ6IDgwMDAgfTtcbiAqICAgICBsaXN0ZW5BbmRTZXJ2ZShvcHRpb25zLCAocmVxKSA9PiB7XG4gKiAgICAgICByZXEucmVzcG9uZCh7IGJvZHkgfSk7XG4gKiAgICAgfSk7XG4gKlxuICogQHBhcmFtIG9wdGlvbnMgU2VydmVyIGNvbmZpZ3VyYXRpb25cbiAqIEBwYXJhbSBoYW5kbGVyIFJlcXVlc3QgaGFuZGxlclxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gbGlzdGVuQW5kU2VydmUoXG4gIGFkZHI6IHN0cmluZyB8IEhUVFBPcHRpb25zLFxuICBoYW5kbGVyOiAocmVxOiBTZXJ2ZXJSZXF1ZXN0KSA9PiB2b2lkLFxuKSB7XG4gIGNvbnN0IHNlcnZlciA9IHNlcnZlKGFkZHIpO1xuXG4gIGZvciBhd2FpdCAoY29uc3QgcmVxdWVzdCBvZiBzZXJ2ZXIpIHtcbiAgICBoYW5kbGVyKHJlcXVlc3QpO1xuICB9XG59XG5cbi8qKiBPcHRpb25zIGZvciBjcmVhdGluZyBhbiBIVFRQUyBzZXJ2ZXIuICovXG5leHBvcnQgdHlwZSBIVFRQU09wdGlvbnMgPSBPbWl0PERlbm8uTGlzdGVuVGxzT3B0aW9ucywgXCJ0cmFuc3BvcnRcIj47XG5cbi8qKlxuICogQ3JlYXRlIGFuIEhUVFBTIHNlcnZlciB3aXRoIGdpdmVuIG9wdGlvbnNcbiAqXG4gKiAgICAgY29uc3QgYm9keSA9IFwiSGVsbG8gSFRUUFNcIjtcbiAqICAgICBjb25zdCBvcHRpb25zID0ge1xuICogICAgICAgaG9zdG5hbWU6IFwibG9jYWxob3N0XCIsXG4gKiAgICAgICBwb3J0OiA0NDMsXG4gKiAgICAgICBjZXJ0RmlsZTogXCIuL3BhdGgvdG8vbG9jYWxob3N0LmNydFwiLFxuICogICAgICAga2V5RmlsZTogXCIuL3BhdGgvdG8vbG9jYWxob3N0LmtleVwiLFxuICogICAgIH07XG4gKiAgICAgZm9yIGF3YWl0IChjb25zdCByZXEgb2Ygc2VydmVUTFMob3B0aW9ucykpIHtcbiAqICAgICAgIHJlcS5yZXNwb25kKHsgYm9keSB9KTtcbiAqICAgICB9XG4gKlxuICogQHBhcmFtIG9wdGlvbnMgU2VydmVyIGNvbmZpZ3VyYXRpb25cbiAqIEByZXR1cm4gQXN5bmMgaXRlcmFibGUgc2VydmVyIGluc3RhbmNlIGZvciBpbmNvbWluZyByZXF1ZXN0c1xuICovXG5leHBvcnQgZnVuY3Rpb24gc2VydmVUTFMob3B0aW9uczogSFRUUFNPcHRpb25zKTogU2VydmVyIHtcbiAgY29uc3QgdGxzT3B0aW9uczogRGVuby5MaXN0ZW5UbHNPcHRpb25zID0ge1xuICAgIC4uLm9wdGlvbnMsXG4gICAgdHJhbnNwb3J0OiBcInRjcFwiLFxuICB9O1xuICBjb25zdCBsaXN0ZW5lciA9IERlbm8ubGlzdGVuVGxzKHRsc09wdGlvbnMpO1xuICByZXR1cm4gbmV3IFNlcnZlcihsaXN0ZW5lcik7XG59XG5cbi8qKlxuICogU3RhcnQgYW4gSFRUUFMgc2VydmVyIHdpdGggZ2l2ZW4gb3B0aW9ucyBhbmQgcmVxdWVzdCBoYW5kbGVyXG4gKlxuICogICAgIGNvbnN0IGJvZHkgPSBcIkhlbGxvIEhUVFBTXCI7XG4gKiAgICAgY29uc3Qgb3B0aW9ucyA9IHtcbiAqICAgICAgIGhvc3RuYW1lOiBcImxvY2FsaG9zdFwiLFxuICogICAgICAgcG9ydDogNDQzLFxuICogICAgICAgY2VydEZpbGU6IFwiLi9wYXRoL3RvL2xvY2FsaG9zdC5jcnRcIixcbiAqICAgICAgIGtleUZpbGU6IFwiLi9wYXRoL3RvL2xvY2FsaG9zdC5rZXlcIixcbiAqICAgICB9O1xuICogICAgIGxpc3RlbkFuZFNlcnZlVExTKG9wdGlvbnMsIChyZXEpID0+IHtcbiAqICAgICAgIHJlcS5yZXNwb25kKHsgYm9keSB9KTtcbiAqICAgICB9KTtcbiAqXG4gKiBAcGFyYW0gb3B0aW9ucyBTZXJ2ZXIgY29uZmlndXJhdGlvblxuICogQHBhcmFtIGhhbmRsZXIgUmVxdWVzdCBoYW5kbGVyXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBsaXN0ZW5BbmRTZXJ2ZVRMUyhcbiAgb3B0aW9uczogSFRUUFNPcHRpb25zLFxuICBoYW5kbGVyOiAocmVxOiBTZXJ2ZXJSZXF1ZXN0KSA9PiB2b2lkLFxuKSB7XG4gIGNvbnN0IHNlcnZlciA9IHNlcnZlVExTKG9wdGlvbnMpO1xuXG4gIGZvciBhd2FpdCAoY29uc3QgcmVxdWVzdCBvZiBzZXJ2ZXIpIHtcbiAgICBoYW5kbGVyKHJlcXVlc3QpO1xuICB9XG59XG5cbi8qKlxuICogSW50ZXJmYWNlIG9mIEhUVFAgc2VydmVyIHJlc3BvbnNlLlxuICogSWYgYm9keSBpcyBhIFJlYWRlciwgcmVzcG9uc2Ugd291bGQgYmUgY2h1bmtlZC5cbiAqIElmIGJvZHkgaXMgYSBzdHJpbmcsIGl0IHdvdWxkIGJlIFVURi04IGVuY29kZWQgYnkgZGVmYXVsdC5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBSZXNwb25zZSB7XG4gIHN0YXR1cz86IG51bWJlcjtcbiAgc3RhdHVzVGV4dD86IHN0cmluZztcbiAgaGVhZGVycz86IEhlYWRlcnM7XG4gIGJvZHk/OiBVaW50OEFycmF5IHwgRGVuby5SZWFkZXIgfCBzdHJpbmc7XG4gIHRyYWlsZXJzPzogKCkgPT4gUHJvbWlzZTxIZWFkZXJzPiB8IEhlYWRlcnM7XG59XG4iXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsRUFBMEUsQUFBMUUsd0VBQTBFO0FBQzFFLE1BQU0sR0FBRyxTQUFTLEVBQUUsU0FBUyxRQUFRLENBQWdCO0FBQ3JELE1BQU0sR0FBRyxNQUFNLFFBQVEsQ0FBb0I7QUFDM0MsTUFBTSxHQUFhLFFBQVEsRUFBRSxnQkFBZ0IsUUFBUSxDQUFpQjtBQUN0RSxNQUFNLEdBQ0osVUFBVSxFQUNWLGlCQUFpQixFQUNqQixXQUFXLEVBQ1gsV0FBVyxFQUNYLGFBQWEsUUFDUixDQUFVO0FBQ2pCLE1BQU0sT0FBTyxhQUFhO0lBQ3hCLEdBQUc7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