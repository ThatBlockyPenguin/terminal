import { encode } from "../encoding/utf8.ts";
import { BufReader, BufWriter } from "../io/bufio.ts";
import { assert } from "../_util/assert.ts";
import { deferred, MuxAsyncIterator } from "../async/mod.ts";
import { bodyReader, chunkedBodyReader, emptyReader, readRequest, writeResponse, } from "./_io.ts";
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
        return this.#done.then((e) => e);
    }
    get contentLength() {
        if (this.#contentLength === undefined) {
            const cl = this.headers.get("content-length");
            if (cl) {
                this.#contentLength = parseInt(cl);
                if (Number.isNaN(this.#contentLength)) {
                    this.#contentLength = null;
                }
            }
            else {
                this.#contentLength = null;
            }
        }
        return this.#contentLength;
    }
    get body() {
        if (!this.#body) {
            if (this.contentLength != null) {
                this.#body = bodyReader(this.contentLength, this.r);
            }
            else {
                const transferEncoding = this.headers.get("transfer-encoding");
                if (transferEncoding != null) {
                    const parts = transferEncoding
                        .split(",")
                        .map((e) => e.trim().toLowerCase());
                    assert(parts.includes("chunked"), 'transfer-encoding must include "chunked" if content-length is not set');
                    this.#body = chunkedBodyReader(this.headers, this.r);
                }
                else {
                    this.#body = emptyReader();
                }
            }
        }
        return this.#body;
    }
    async respond(r) {
        let err;
        try {
            await writeResponse(this.w, r);
        }
        catch (e) {
            try {
                this.conn.close();
            }
            catch {
            }
            err = e;
        }
        this.#done.resolve(err);
        if (err) {
            throw err;
        }
    }
    async finalize() {
        if (this.#finalized)
            return;
        const body = this.body;
        const buf = new Uint8Array(1024);
        while ((await body.read(buf)) !== null) {
        }
        this.#finalized = true;
    }
}
export class Server {
    listener;
    #closing = false;
    #connections = [];
    constructor(listener) {
        this.listener = listener;
    }
    close() {
        this.#closing = true;
        this.listener.close();
        for (const conn of this.#connections) {
            try {
                conn.close();
            }
            catch (e) {
                if (!(e instanceof Deno.errors.BadResource)) {
                    throw e;
                }
            }
        }
    }
    async *iterateHttpRequests(conn) {
        const reader = new BufReader(conn);
        const writer = new BufWriter(conn);
        while (!this.#closing) {
            let request;
            try {
                request = await readRequest(conn, reader);
            }
            catch (error) {
                if (error instanceof Deno.errors.InvalidData ||
                    error instanceof Deno.errors.UnexpectedEof) {
                    try {
                        await writeResponse(writer, {
                            status: 400,
                            body: encode(`${error.message}\r\n\r\n`),
                        });
                    }
                    catch (error) {
                    }
                }
                break;
            }
            if (request === null) {
                break;
            }
            request.w = writer;
            yield request;
            const responseError = await request.done;
            if (responseError) {
                this.untrackConnection(request.conn);
                return;
            }
            try {
                await request.finalize();
            }
            catch (error) {
                break;
            }
        }
        this.untrackConnection(conn);
        try {
            conn.close();
        }
        catch (e) {
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
    async *acceptConnAndIterateHttpRequests(mux) {
        if (this.#closing)
            return;
        let conn;
        try {
            conn = await this.listener.accept();
        }
        catch (error) {
            if (error instanceof Deno.errors.BadResource ||
                error instanceof Deno.errors.InvalidData ||
                error instanceof Deno.errors.UnexpectedEof ||
                error instanceof Deno.errors.ConnectionReset) {
                return mux.add(this.acceptConnAndIterateHttpRequests(mux));
            }
            throw error;
        }
        this.trackConnection(conn);
        mux.add(this.acceptConnAndIterateHttpRequests(mux));
        yield* this.iterateHttpRequests(conn);
    }
    [Symbol.asyncIterator]() {
        const mux = new MuxAsyncIterator();
        mux.add(this.acceptConnAndIterateHttpRequests(mux));
        return mux.iterate();
    }
}
export function _parseAddrFromStr(addr) {
    let url;
    try {
        const host = addr.startsWith(":") ? `0.0.0.0${addr}` : addr;
        url = new URL(`http://${host}`);
    }
    catch {
        throw new TypeError("Invalid address.");
    }
    if (url.username ||
        url.password ||
        url.pathname != "/" ||
        url.search ||
        url.hash) {
        throw new TypeError("Invalid address.");
    }
    return {
        hostname: url.hostname,
        port: url.port === "" ? 80 : Number(url.port),
    };
}
export function serve(addr) {
    if (typeof addr === "string") {
        addr = _parseAddrFromStr(addr);
    }
    const listener = Deno.listen(addr);
    return new Server(listener);
}
export async function listenAndServe(addr, handler) {
    const server = serve(addr);
    for await (const request of server) {
        handler(request);
    }
}
export function serveTLS(options) {
    const tlsOptions = {
        ...options,
        transport: "tcp",
    };
    const listener = Deno.listenTls(tlsOptions);
    return new Server(listener);
}
export async function listenAndServeTLS(options, handler) {
    const server = serveTLS(options);
    for await (const request of server) {
        handler(request);
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2VydmVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsic2VydmVyLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUNBLE9BQU8sRUFBRSxNQUFNLEVBQUUsTUFBTSxxQkFBcUIsQ0FBQztBQUM3QyxPQUFPLEVBQUUsU0FBUyxFQUFFLFNBQVMsRUFBRSxNQUFNLGdCQUFnQixDQUFDO0FBQ3RELE9BQU8sRUFBRSxNQUFNLEVBQUUsTUFBTSxvQkFBb0IsQ0FBQztBQUM1QyxPQUFPLEVBQVksUUFBUSxFQUFFLGdCQUFnQixFQUFFLE1BQU0saUJBQWlCLENBQUM7QUFDdkUsT0FBTyxFQUNMLFVBQVUsRUFDVixpQkFBaUIsRUFDakIsV0FBVyxFQUNYLFdBQVcsRUFDWCxhQUFhLEdBQ2QsTUFBTSxVQUFVLENBQUM7QUFFbEIsTUFBTSxPQUFPLGFBQWE7SUFDeEIsR0FBRyxDQUFVO0lBQ2IsTUFBTSxDQUFVO0lBQ2hCLEtBQUssQ0FBVTtJQUNmLFVBQVUsQ0FBVTtJQUNwQixVQUFVLENBQVU7SUFDcEIsT0FBTyxDQUFXO0lBQ2xCLElBQUksQ0FBYTtJQUNqQixDQUFDLENBQWE7SUFDZCxDQUFDLENBQWE7SUFFZCxLQUFLLEdBQWdDLFFBQVEsRUFBRSxDQUFDO0lBQ2hELGNBQWMsR0FBbUIsU0FBUyxDQUFDO0lBQzNDLEtBQUssR0FBaUIsU0FBUyxDQUFDO0lBQ2hDLFVBQVUsR0FBRyxLQUFLLENBQUM7SUFFbkIsSUFBSSxJQUFJO1FBQ04sT0FBTyxJQUFJLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsRUFBRSxFQUFFLENBQUMsQ0FBQyxDQUFDLENBQUM7SUFDbkMsQ0FBQztJQU1ELElBQUksYUFBYTtRQUdmLElBQUksSUFBSSxDQUFDLGNBQWMsS0FBSyxTQUFTLEVBQUU7WUFDckMsTUFBTSxFQUFFLEdBQUcsSUFBSSxDQUFDLE9BQU8sQ0FBQyxHQUFHLENBQUMsZ0JBQWdCLENBQUMsQ0FBQztZQUM5QyxJQUFJLEVBQUUsRUFBRTtnQkFD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QUMsQ0FBQztBQUM5QixDQUFDO0FBbUJELE1BQU0sQ0FBQyxLQUFLLFVBQVUsaUJBQWlCLENBQ3JDLE9BQXFCLEVBQ3JCLE9BQXFDO0lBRXJDLE1BQU0sTUFBTSxHQUFHLFFBQVEsQ0FBQyxPQUFPLENBQUMsQ0FBQztJQUVqQyxJQUFJLEtBQUssRUFBRSxNQUFNLE9BQU8sSUFBSSxNQUFNLEVBQUU7UUFDbEMsT0FBTyxDQUFDLE9BQU8sQ0FBQyxDQUFDO0tBQ2xCO0FBQ0gsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8vIENvcHlyaWdodCAyMDE4LTIwMjEgdGhlIERlbm8gYXV0aG9ycy4gQWxsIHJpZ2h0cyByZXNlcnZlZC4gTUlUIGxpY2Vuc2UuXG5pbXBvcnQgeyBlbmNvZGUgfSBmcm9tIFwiLi4vZW5jb2RpbmcvdXRmOC50c1wiO1xuaW1wb3J0IHsgQnVmUmVhZGVyLCBCdWZXcml0ZXIgfSBmcm9tIFwiLi4vaW8vYnVmaW8udHNcIjtcbmltcG9ydCB7IGFzc2VydCB9IGZyb20gXCIuLi9fdXRpbC9hc3NlcnQudHNcIjtcbmltcG9ydCB7IERlZmVycmVkLCBkZWZlcnJlZCwgTXV4QXN5bmNJdGVyYXRvciB9IGZyb20gXCIuLi9hc3luYy9tb2QudHNcIjtcbmltcG9ydCB7XG4gIGJvZHlSZWFkZXIsXG4gIGNodW5rZWRCb2R5UmVhZGVyLFxuICBlbXB0eVJlYWRlcixcbiAgcmVhZFJlcXVlc3QsXG4gIHdyaXRlUmVzcG9uc2UsXG59IGZyb20gXCIuL19pby50c1wiO1xuXG5leHBvcnQgY2xhc3MgU2VydmVyUmVxdWVzdCB7XG4gIHVybCE6IHN0cmluZztcbiAgbWV0aG9kITogc3RyaW5nO1xuICBwcm90byE6IHN0cmluZztcbiAgcHJvdG9NaW5vciE6IG51bWJlcjtcbiAgcHJvdG9NYWpvciE6IG51bWJlcjtcbiAgaGVhZGVycyE6IEhlYWRlcnM7XG4gIGNvbm4hOiBEZW5vLkNvbm47XG4gIHIhOiBCdWZSZWFkZXI7XG4gIHchOiBCdWZXcml0ZXI7XG5cbiAgI2RvbmU6IERlZmVycmVkPEVycm9yIHwgdW5kZWZpbmVkPiA9IGRlZmVycmVkKCk7XG4gICNjb250ZW50TGVuZ3RoPzogbnVtYmVyIHwgbnVsbCA9IHVuZGVmaW5lZDtcbiAgI2JvZHk/OiBEZW5vLlJlYWRlciA9IHVuZGVmaW5lZDtcbiAgI2ZpbmFsaXplZCA9IGZhbHNlO1xuXG4gIGdldCBkb25lKCk6IFByb21pc2U8RXJyb3IgfCB1bmRlZmluZWQ+IHtcbiAgICByZXR1cm4gdGhpcy4jZG9uZS50aGVuKChlKSA9PiBlKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBWYWx1ZSBvZiBDb250ZW50LUxlbmd0aCBoZWFkZXIuXG4gICAqIElmIG51bGwsIHRoZW4gY29udGVudCBsZW5ndGggaXMgaW52YWxpZCBvciBub3QgZ2l2ZW4gKGUuZy4gY2h1bmtlZCBlbmNvZGluZykuXG4gICAqL1xuICBnZXQgY29udGVudExlbmd0aCgpOiBudW1iZXIgfCBudWxsIHtcbiAgICAvLyB1bmRlZmluZWQgbWVhbnMgbm90IGNhY2hlZC5cbiAgICAvLyBudWxsIG1lYW5zIGludmFsaWQgb3Igbm90IHByb3ZpZGVkLlxuICAgIGlmICh0aGlzLiNjb250ZW50TGVuZ3RoID09PSB1bmRlZmluZWQpIHtcbiAgICAgIGNvbnN0IGNsID0gdGhpcy5oZWFkZXJzLmdldChcImNvbnRlbnQtbGVuZ3RoXCIpO1xuICAgICAgaWYgKGNsKSB7XG4gICAgICAgIHRoaXMuI2NvbnRlbnRMZW5ndGggPSBwYXJzZUludChjbCk7XG4gICAgICAgIC8vIENvbnZlcnQgTmFOIHRvIG51bGwgKGFzIE5hTiBoYXJkZXIgdG8gdGVzdClcbiAgICAgICAgaWYgKE51bWJlci5pc05hTih0aGlzLiNjb250ZW50TGVuZ3RoKSkge1xuICAgICAgICAgIHRoaXMuI2NvbnRlbnRMZW5ndGggPSBudWxsO1xuICAgICAgICB9XG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0aGlzLiNjb250ZW50TGVuZ3RoID0gbnVsbDtcbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIHRoaXMuI2NvbnRlbnRMZW5ndGg7XG4gIH1cblxuICAvKipcbiAgICogQm9keSBvZiB0aGUgcmVxdWVzdC4gIFRoZSBlYXNpZXN0IHdheSB0byBjb25zdW1lIHRoZSBib2R5IGlzOlxuICAgKlxuICAgKiAgICAgY29uc3QgYnVmOiBVaW50OEFycmF5ID0gYXdhaXQgRGVuby5yZWFkQWxsKHJlcS5ib2R5KTtcbiAgICovXG4gIGdldCBib2R5KCk6IERlbm8uUmVhZGVyIHtcbiAgICBpZiAoIXRoaXMuI2JvZHkpIHtcbiAgICAgIGlmICh0aGlzLmNvbnRlbnRMZW5ndGggIT0gbnVsbCkge1xuICAgICAgICB0aGlzLiNib2R5ID0gYm9keVJlYWRlcih0aGlzLmNvbnRlbnRMZW5ndGgsIHRoaXMucik7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBjb25zdCB0cmFuc2ZlckVuY29kaW5nID0gdGhpcy5oZWFkZXJzLmdldChcInRyYW5zZmVyLWVuY29kaW5nXCIpO1xuICAgICAgICBpZiAodHJhbnNmZXJFbmNvZGluZyAhPSBudWxsKSB7XG4gICAgICAgICAgY29uc3QgcGFydHMgPSB0cmFuc2ZlckVuY29kaW5nXG4gICAgICAgICAgICAuc3BsaXQoXCIsXCIpXG4gICAgICAgICAgICAubWFwKChlKTogc3RyaW5nID0+IGUudHJpbSgpLnRvTG93ZXJDYXNlKCkpO1xuICAgICAgICAgIGFzc2VydChcbiAgICAgICAgICAgIHBhcnRzLmluY2x1ZGVzKFwiY2h1bmtlZFwiKSxcbiAgICAgICAgICAgICd0cmFuc2Zlci1lbmNvZGluZyBtdXN0IGluY2x1ZGUgXCJjaHVua2VkXCIgaWYgY29udGVudC1sZW5ndGggaXMgbm90IHNldCcsXG4gICAgICAgICAgKTtcbiAgICAgICAgICB0aGlzLiNib2R5ID0gY2h1bmtlZEJvZHlSZWFkZXIodGhpcy5oZWFkZXJzLCB0aGlzLnIpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIC8vIE5laXRoZXIgY29udGVudC1sZW5ndGggbm9yIHRyYW5zZmVyLWVuY29kaW5nOiBjaHVua2VkXG4gICAgICAgICAgdGhpcy4jYm9keSA9IGVtcHR5UmVhZGVyKCk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIHRoaXMuI2JvZHk7XG4gIH1cblxuICBhc3luYyByZXNwb25kKHI6IFJlc3BvbnNlKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgbGV0IGVycjogRXJyb3IgfCB1bmRlZmluZWQ7XG4gICAgdHJ5IHtcbiAgICAgIC8vIFdyaXRlIG91ciByZXNwb25zZSFcbiAgICAgIGF3YWl0IHdyaXRlUmVzcG9uc2UodGhpcy53LCByKTtcbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICB0cnkge1xuICAgICAgICAvLyBFYWdlcmx5IGNsb3NlIG9uIGVycm9yLlxuICAgICAgICB0aGlzLmNvbm4uY2xvc2UoKTtcbiAgICAgIH0gY2F0Y2gge1xuICAgICAgICAvLyBQYXNzXG4gICAgICB9XG4gICAgICBlcnIgPSBlO1xuICAgIH1cbiAgICAvLyBTaWduYWwgdGhhdCB0aGlzIHJlcXVlc3QgaGFzIGJlZW4gcHJvY2Vzc2VkIGFuZCB0aGUgbmV4dCBwaXBlbGluZWRcbiAgICAvLyByZXF1ZXN0IG9uIHRoZSBzYW1lIGNvbm5lY3Rpb24gY2FuIGJlIGFjY2VwdGVkLlxuICAgIHRoaXMuI2RvbmUucmVzb2x2ZShlcnIpO1xuICAgIGlmIChlcnIpIHtcbiAgICAgIC8vIEVycm9yIGR1cmluZyByZXNwb25kaW5nLCByZXRocm93LlxuICAgICAgdGhyb3cgZXJyO1xuICAgIH1cbiAgfVxuXG4gIGFzeW5jIGZpbmFsaXplKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGlmICh0aGlzLiNmaW5hbGl6ZWQpIHJldHVybjtcbiAgICAvLyBDb25zdW1lIHVucmVhZCBib2R5XG4gICAgY29uc3QgYm9keSA9IHRoaXMuYm9keTtcbiAgICBjb25zdCBidWYgPSBuZXcgVWludDhBcnJheSgxMDI0KTtcbiAgICB3aGlsZSAoKGF3YWl0IGJvZHkucmVhZChidWYpKSAhPT0gbnVsbCkge1xuICAgICAgLy8gUGFzc1xuICAgIH1cbiAgICB0aGlzLiNmaW5hbGl6ZWQgPSB0cnVlO1xuICB9XG59XG5cbmV4cG9ydCBjbGFzcyBTZXJ2ZXIgaW1wbGVtZW50cyBBc3luY0l0ZXJhYmxlPFNlcnZlclJlcXVlc3Q+IHtcbiAgI2Nsb3NpbmcgPSBmYWxzZTtcbiAgI2Nvbm5lY3Rpb25zOiBEZW5vLkNvbm5bXSA9IFtdO1xuXG4gIGNvbnN0cnVjdG9yKHB1YmxpYyBsaXN0ZW5lcjogRGVuby5MaXN0ZW5lcikge31cblxuICBjbG9zZSgpOiB2b2lkIHtcbiAgICB0aGlzLiNjbG9zaW5nID0gdHJ1ZTtcbiAgICB0aGlzLmxpc3RlbmVyLmNsb3NlKCk7XG4gICAgZm9yIChjb25zdCBjb25uIG9mIHRoaXMuI2Nvbm5lY3Rpb25zKSB7XG4gICAgICB0cnkge1xuICAgICAgICBjb25uLmNsb3NlKCk7XG4gICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgIC8vIENvbm5lY3Rpb24gbWlnaHQgaGF2ZSBiZWVuIGFscmVhZHkgY2xvc2VkXG4gICAgICAgIGlmICghKGUgaW5zdGFuY2VvZiBEZW5vLmVycm9ycy5CYWRSZXNvdXJjZSkpIHtcbiAgICAgICAgICB0aHJvdyBlO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLy8gWWllbGRzIGFsbCBIVFRQIHJlcXVlc3RzIG9uIGEgc2luZ2xlIFRDUCBjb25uZWN0aW9uLlxuICBwcml2YXRlIGFzeW5jICppdGVyYXRlSHR0cFJlcXVlc3RzKFxuICAgIGNvbm46IERlbm8uQ29ubixcbiAgKTogQXN5bmNJdGVyYWJsZUl0ZXJhdG9yPFNlcnZlclJlcXVlc3Q+IHtcbiAgICBjb25zdCByZWFkZXIgPSBuZXcgQnVmUmVhZGVyKGNvbm4pO1xuICAgIGNvbnN0IHdyaXRlciA9IG5ldyBCdWZXcml0ZXIoY29ubik7XG5cbiAgICB3aGlsZSAoIXRoaXMuI2Nsb3NpbmcpIHtcbiAgICAgIGxldCByZXF1ZXN0OiBTZXJ2ZXJSZXF1ZXN0IHwgbnVsbDtcbiAgICAgIHRyeSB7XG4gICAgICAgIHJlcXVlc3QgPSBhd2FpdCByZWFkUmVxdWVzdChjb25uLCByZWFkZXIpO1xuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgaWYgKFxuICAgICAgICAgIGVycm9yIGluc3RhbmNlb2YgRGVuby5lcnJvcnMuSW52YWxpZERhdGEgfHxcbiAgICAgICAgICBlcnJvciBpbnN0YW5jZW9mIERlbm8uZXJyb3JzLlVuZXhwZWN0ZWRFb2ZcbiAgICAgICAgKSB7XG4gICAgICAgICAgLy8gQW4gZXJyb3Igd2FzIHRocm93biB3aGlsZSBwYXJzaW5nIHJlcXVlc3QgaGVhZGVycy5cbiAgICAgICAgICAvLyBUcnkgdG8gc2VuZCB0aGUgXCI0MDAgQmFkIFJlcXVlc3RcIiBiZWZvcmUgY2xvc2luZyB0aGUgY29ubmVjdGlvbi5cbiAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgYXdhaXQgd3JpdGVSZXNwb25zZSh3cml0ZXIsIHtcbiAgICAgICAgICAgICAgc3RhdHVzOiA0MDAsXG4gICAgICAgICAgICAgIGJvZHk6IGVuY29kZShgJHtlcnJvci5tZXNzYWdlfVxcclxcblxcclxcbmApLFxuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgIC8vIFRoZSBjb25uZWN0aW9uIGlzIGJyb2tlbi5cbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgYnJlYWs7XG4gICAgICB9XG4gICAgICBpZiAocmVxdWVzdCA9PT0gbnVsbCkge1xuICAgICAgICBicmVhaztcbiAgICAgIH1cblxuICAgICAgcmVxdWVzdC53ID0gd3JpdGVyO1xuICAgICAgeWllbGQgcmVxdWVzdDtcblxuICAgICAgLy8gV2FpdCBmb3IgdGhlIHJlcXVlc3QgdG8gYmUgcHJvY2Vzc2VkIGJlZm9yZSB3ZSBhY2NlcHQgYSBuZXcgcmVxdWVzdCBvblxuICAgICAgLy8gdGhpcyBjb25uZWN0aW9uLlxuICAgICAgY29uc3QgcmVzcG9uc2VFcnJvciA9IGF3YWl0IHJlcXVlc3QuZG9uZTtcbiAgICAgIGlmIChyZXNwb25zZUVycm9yKSB7XG4gICAgICAgIC8vIFNvbWV0aGluZyBiYWQgaGFwcGVuZWQgZHVyaW5nIHJlc3BvbnNlLlxuICAgICAgICAvLyAobGlrZWx5IG90aGVyIHNpZGUgY2xvc2VkIGR1cmluZyBwaXBlbGluZWQgcmVxKVxuICAgICAgICAvLyByZXEuZG9uZSBpbXBsaWVzIHRoaXMgY29ubmVjdGlvbiBhbHJlYWR5IGNsb3NlZCwgc28gd2UgY2FuIGp1c3QgcmV0dXJuLlxuICAgICAgICB0aGlzLnVudHJhY2tDb25uZWN0aW9uKHJlcXVlc3QuY29ubik7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cblxuICAgICAgdHJ5IHtcbiAgICAgICAgLy8gQ29uc3VtZSB1bnJlYWQgYm9keSBhbmQgdHJhaWxlcnMgaWYgcmVjZWl2ZXIgZGlkbid0IGNvbnN1bWUgdGhvc2UgZGF0YVxuICAgICAgICBhd2FpdCByZXF1ZXN0LmZpbmFsaXplKCk7XG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAvLyBJbnZhbGlkIGRhdGEgd2FzIHJlY2VpdmVkIG9yIHRoZSBjb25uZWN0aW9uIHdhcyBjbG9zZWQuXG4gICAgICAgIGJyZWFrO1xuICAgICAgfVxuICAgIH1cblxuICAgIHRoaXMudW50cmFja0Nvbm5lY3Rpb24oY29ubik7XG4gICAgdHJ5IHtcbiAgICAgIGNvbm4uY2xvc2UoKTtcbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICAvLyBtaWdodCBoYXZlIGJlZW4gYWxyZWFkeSBjbG9zZWRcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIHRyYWNrQ29ubmVjdGlvbihjb25uOiBEZW5vLkNvbm4pOiB2b2lkIHtcbiAgICB0aGlzLiNjb25uZWN0aW9ucy5wdXNoKGNvbm4pO1xuICB9XG5cbiAgcHJpdmF0ZSB1bnRyYWNrQ29ubmVjdGlvbihjb25uOiBEZW5vLkNvbm4pOiB2b2lkIHtcbiAgICBjb25zdCBpbmRleCA9IHRoaXMuI2Nvbm5lY3Rpb25zLmluZGV4T2YoY29ubik7XG4gICAgaWYgKGluZGV4ICE9PSAtMSkge1xuICAgICAgdGhpcy4jY29ubmVjdGlvbnMuc3BsaWNlKGluZGV4LCAxKTtcbiAgICB9XG4gIH1cblxuICAvLyBBY2NlcHRzIGEgbmV3IFRDUCBjb25uZWN0aW9uIGFuZCB5aWVsZHMgYWxsIEhUVFAgcmVxdWVzdHMgdGhhdCBhcnJpdmUgb25cbiAgLy8gaXQuIFdoZW4gYSBjb25uZWN0aW9uIGlzIGFjY2VwdGVkLCBpdCBhbHNvIGNyZWF0ZXMgYSBuZXcgaXRlcmF0b3Igb2YgdGhlXG4gIC8vIHNhbWUga2luZCBhbmQgYWRkcyBpdCB0byB0aGUgcmVxdWVzdCBtdWx0aXBsZXhlciBzbyB0aGF0IGFub3RoZXIgVENQXG4gIC8vIGNvbm5lY3Rpb24gY2FuIGJlIGFjY2VwdGVkLlxuICBwcml2YXRlIGFzeW5jICphY2NlcHRDb25uQW5kSXRlcmF0ZUh0dHBSZXF1ZXN0cyhcbiAgICBtdXg6IE11eEFzeW5jSXRlcmF0b3I8U2VydmVyUmVxdWVzdD4sXG4gICk6IEFzeW5jSXRlcmFibGVJdGVyYXRvcjxTZXJ2ZXJSZXF1ZXN0PiB7XG4gICAgaWYgKHRoaXMuI2Nsb3NpbmcpIHJldHVybjtcbiAgICAvLyBXYWl0IGZvciBhIG5ldyBjb25uZWN0aW9uLlxuICAgIGxldCBjb25uOiBEZW5vLkNvbm47XG4gICAgdHJ5IHtcbiAgICAgIGNvbm4gPSBhd2FpdCB0aGlzLmxpc3RlbmVyLmFjY2VwdCgpO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBpZiAoXG4gICAgICAgIC8vIFRoZSBsaXN0ZW5lciBpcyBjbG9zZWQ6XG4gICAgICAgIGVycm9yIGluc3RhbmNlb2YgRGVuby5lcnJvcnMuQmFkUmVzb3VyY2UgfHxcbiAgICAgICAgLy8gVExTIGhhbmRzaGFrZSBlcnJvcnM6XG4gICAgICAgIGVycm9yIGluc3RhbmNlb2YgRGVuby5lcnJvcnMuSW52YWxpZERhdGEgfHxcbiAgICAgICAgZXJyb3IgaW5zdGFuY2VvZiBEZW5vLmVycm9ycy5VbmV4cGVjdGVkRW9mIHx8XG4gICAgICAgIGVycm9yIGluc3RhbmNlb2YgRGVuby5lcnJvcnMuQ29ubmVjdGlvblJlc2V0XG4gICAgICApIHtcbiAgICAgICAgcmV0dXJuIG11eC5hZGQodGhpcy5hY2NlcHRDb25uQW5kSXRlcmF0ZUh0dHBSZXF1ZXN0cyhtdXgpKTtcbiAgICAgIH1cbiAgICAgIHRocm93IGVycm9yO1xuICAgIH1cbiAgICB0aGlzLnRyYWNrQ29ubmVjdGlvbihjb25uKTtcbiAgICAvLyBUcnkgdG8gYWNjZXB0IGFub3RoZXIgY29ubmVjdGlvbiBhbmQgYWRkIGl0IHRvIHRoZSBtdWx0aXBsZXhlci5cbiAgICBtdXguYWRkKHRoaXMuYWNjZXB0Q29ubkFuZEl0ZXJhdGVIdHRwUmVxdWVzdHMobXV4KSk7XG4gICAgLy8gWWllbGQgdGhlIHJlcXVlc3RzIHRoYXQgYXJyaXZlIG9uIHRoZSBqdXN0LWFjY2VwdGVkIGNvbm5lY3Rpb24uXG4gICAgeWllbGQqIHRoaXMuaXRlcmF0ZUh0dHBSZXF1ZXN0cyhjb25uKTtcbiAgfVxuXG4gIFtTeW1ib2wuYXN5bmNJdGVyYXRvcl0oKTogQXN5bmNJdGVyYWJsZUl0ZXJhdG9yPFNlcnZlclJlcXVlc3Q+IHtcbiAgICBjb25zdCBtdXg6IE11eEFzeW5jSXRlcmF0b3I8U2VydmVyUmVxdWVzdD4gPSBuZXcgTXV4QXN5bmNJdGVyYXRvcigpO1xuICAgIG11eC5hZGQodGhpcy5hY2NlcHRDb25uQW5kSXRlcmF0ZUh0dHBSZXF1ZXN0cyhtdXgpKTtcbiAgICByZXR1cm4gbXV4Lml0ZXJhdGUoKTtcbiAgfVxufVxuXG4vKiogT3B0aW9ucyBmb3IgY3JlYXRpbmcgYW4gSFRUUCBzZXJ2ZXIuICovXG5leHBvcnQgdHlwZSBIVFRQT3B0aW9ucyA9IE9taXQ8RGVuby5MaXN0ZW5PcHRpb25zLCBcInRyYW5zcG9ydFwiPjtcblxuLyoqXG4gKiBQYXJzZSBhZGRyIGZyb20gc3RyaW5nXG4gKlxuICogICAgIGNvbnN0IGFkZHIgPSBcIjo6MTo4MDAwXCI7XG4gKiAgICAgcGFyc2VBZGRyRnJvbVN0cmluZyhhZGRyKTtcbiAqXG4gKiBAcGFyYW0gYWRkciBBZGRyZXNzIHN0cmluZ1xuICovXG5leHBvcnQgZnVuY3Rpb24gX3BhcnNlQWRkckZyb21TdHIoYWRkcjogc3RyaW5nKTogSFRUUE9wdGlvbnMge1xuICBsZXQgdXJsOiBVUkw7XG4gIHRyeSB7XG4gICAgY29uc3QgaG9zdCA9IGFkZHIuc3RhcnRzV2l0aChcIjpcIikgPyBgMC4wLjAuMCR7YWRkcn1gIDogYWRkcjtcbiAgICB1cmwgPSBuZXcgVVJMKGBodHRwOi8vJHtob3N0fWApO1xuICB9IGNhdGNoIHtcbiAgICB0aHJvdyBuZXcgVHlwZUVycm9yKFwiSW52YWxpZCBhZGRyZXNzLlwiKTtcbiAgfVxuICBpZiAoXG4gICAgdXJsLnVzZXJuYW1lIHx8XG4gICAgdXJsLnBhc3N3b3JkIHx8XG4gICAgdXJsLnBhdGhuYW1lICE9IFwiL1wiIHx8XG4gICAgdXJsLnNlYXJjaCB8fFxuICAgIHVybC5oYXNoXG4gICkge1xuICAgIHRocm93IG5ldyBUeXBlRXJyb3IoXCJJbnZhbGlkIGFkZHJlc3MuXCIpO1xuICB9XG5cbiAgcmV0dXJuIHtcbiAgICBob3N0bmFtZTogdXJsLmhvc3RuYW1lLFxuICAgIHBvcnQ6IHVybC5wb3J0ID09PSBcIlwiID8gODAgOiBOdW1iZXIodXJsLnBvcnQpLFxuICB9O1xufVxuXG4vKipcbiAqIENyZWF0ZSBhIEhUVFAgc2VydmVyXG4gKlxuICogICAgIGltcG9ydCB7IHNlcnZlIH0gZnJvbSBcImh0dHBzOi8vZGVuby5sYW5kL3N0ZC9odHRwL3NlcnZlci50c1wiO1xuICogICAgIGNvbnN0IGJvZHkgPSBcIkhlbGxvIFdvcmxkXFxuXCI7XG4gKiAgICAgY29uc3Qgc2VydmVyID0gc2VydmUoeyBwb3J0OiA4MDAwIH0pO1xuICogICAgIGZvciBhd2FpdCAoY29uc3QgcmVxIG9mIHNlcnZlcikge1xuICogICAgICAgcmVxLnJlc3BvbmQoeyBib2R5IH0pO1xuICogICAgIH1cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHNlcnZlKGFkZHI6IHN0cmluZyB8IEhUVFBPcHRpb25zKTogU2VydmVyIHtcbiAgaWYgKHR5cGVvZiBhZGRyID09PSBcInN0cmluZ1wiKSB7XG4gICAgYWRkciA9IF9wYXJzZUFkZHJGcm9tU3RyKGFkZHIpO1xuICB9XG5cbiAgY29uc3QgbGlzdGVuZXIgPSBEZW5vLmxpc3RlbihhZGRyKTtcbiAgcmV0dXJuIG5ldyBTZXJ2ZXIobGlzdGVuZXIpO1xufVxuXG4vKipcbiAqIFN0YXJ0IGFuIEhUVFAgc2VydmVyIHdpdGggZ2l2ZW4gb3B0aW9ucyBhbmQgcmVxdWVzdCBoYW5kbGVyXG4gKlxuICogICAgIGNvbnN0IGJvZHkgPSBcIkhlbGxvIFdvcmxkXFxuXCI7XG4gKiAgICAgY29uc3Qgb3B0aW9ucyA9IHsgcG9ydDogODAwMCB9O1xuICogICAgIGxpc3RlbkFuZFNlcnZlKG9wdGlvbnMsIChyZXEpID0+IHtcbiAqICAgICAgIHJlcS5yZXNwb25kKHsgYm9keSB9KTtcbiAqICAgICB9KTtcbiAqXG4gKiBAcGFyYW0gb3B0aW9ucyBTZXJ2ZXIgY29uZmlndXJhdGlvblxuICogQHBhcmFtIGhhbmRsZXIgUmVxdWVzdCBoYW5kbGVyXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBsaXN0ZW5BbmRTZXJ2ZShcbiAgYWRkcjogc3RyaW5nIHwgSFRUUE9wdGlvbnMsXG4gIGhhbmRsZXI6IChyZXE6IFNlcnZlclJlcXVlc3QpID0+IHZvaWQsXG4pOiBQcm9taXNlPHZvaWQ+IHtcbiAgY29uc3Qgc2VydmVyID0gc2VydmUoYWRkcik7XG5cbiAgZm9yIGF3YWl0IChjb25zdCByZXF1ZXN0IG9mIHNlcnZlcikge1xuICAgIGhhbmRsZXIocmVxdWVzdCk7XG4gIH1cbn1cblxuLyoqIE9wdGlvbnMgZm9yIGNyZWF0aW5nIGFuIEhUVFBTIHNlcnZlci4gKi9cbmV4cG9ydCB0eXBlIEhUVFBTT3B0aW9ucyA9IE9taXQ8RGVuby5MaXN0ZW5UbHNPcHRpb25zLCBcInRyYW5zcG9ydFwiPjtcblxuLyoqXG4gKiBDcmVhdGUgYW4gSFRUUFMgc2VydmVyIHdpdGggZ2l2ZW4gb3B0aW9uc1xuICpcbiAqICAgICBjb25zdCBib2R5ID0gXCJIZWxsbyBIVFRQU1wiO1xuICogICAgIGNvbnN0IG9wdGlvbnMgPSB7XG4gKiAgICAgICBob3N0bmFtZTogXCJsb2NhbGhvc3RcIixcbiAqICAgICAgIHBvcnQ6IDQ0MyxcbiAqICAgICAgIGNlcnRGaWxlOiBcIi4vcGF0aC90by9sb2NhbGhvc3QuY3J0XCIsXG4gKiAgICAgICBrZXlGaWxlOiBcIi4vcGF0aC90by9sb2NhbGhvc3Qua2V5XCIsXG4gKiAgICAgfTtcbiAqICAgICBmb3IgYXdhaXQgKGNvbnN0IHJlcSBvZiBzZXJ2ZVRMUyhvcHRpb25zKSkge1xuICogICAgICAgcmVxLnJlc3BvbmQoeyBib2R5IH0pO1xuICogICAgIH1cbiAqXG4gKiBAcGFyYW0gb3B0aW9ucyBTZXJ2ZXIgY29uZmlndXJhdGlvblxuICogQHJldHVybiBBc3luYyBpdGVyYWJsZSBzZXJ2ZXIgaW5zdGFuY2UgZm9yIGluY29taW5nIHJlcXVlc3RzXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzZXJ2ZVRMUyhvcHRpb25zOiBIVFRQU09wdGlvbnMpOiBTZXJ2ZXIge1xuICBjb25zdCB0bHNPcHRpb25zOiBEZW5vLkxpc3RlblRsc09wdGlvbnMgPSB7XG4gICAgLi4ub3B0aW9ucyxcbiAgICB0cmFuc3BvcnQ6IFwidGNwXCIsXG4gIH07XG4gIGNvbnN0IGxpc3RlbmVyID0gRGVuby5saXN0ZW5UbHModGxzT3B0aW9ucyk7XG4gIHJldHVybiBuZXcgU2VydmVyKGxpc3RlbmVyKTtcbn1cblxuLyoqXG4gKiBTdGFydCBhbiBIVFRQUyBzZXJ2ZXIgd2l0aCBnaXZlbiBvcHRpb25zIGFuZCByZXF1ZXN0IGhhbmRsZXJcbiAqXG4gKiAgICAgY29uc3QgYm9keSA9IFwiSGVsbG8gSFRUUFNcIjtcbiAqICAgICBjb25zdCBvcHRpb25zID0ge1xuICogICAgICAgaG9zdG5hbWU6IFwibG9jYWxob3N0XCIsXG4gKiAgICAgICBwb3J0OiA0NDMsXG4gKiAgICAgICBjZXJ0RmlsZTogXCIuL3BhdGgvdG8vbG9jYWxob3N0LmNydFwiLFxuICogICAgICAga2V5RmlsZTogXCIuL3BhdGgvdG8vbG9jYWxob3N0LmtleVwiLFxuICogICAgIH07XG4gKiAgICAgbGlzdGVuQW5kU2VydmVUTFMob3B0aW9ucywgKHJlcSkgPT4ge1xuICogICAgICAgcmVxLnJlc3BvbmQoeyBib2R5IH0pO1xuICogICAgIH0pO1xuICpcbiAqIEBwYXJhbSBvcHRpb25zIFNlcnZlciBjb25maWd1cmF0aW9uXG4gKiBAcGFyYW0gaGFuZGxlciBSZXF1ZXN0IGhhbmRsZXJcbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGxpc3RlbkFuZFNlcnZlVExTKFxuICBvcHRpb25zOiBIVFRQU09wdGlvbnMsXG4gIGhhbmRsZXI6IChyZXE6IFNlcnZlclJlcXVlc3QpID0+IHZvaWQsXG4pOiBQcm9taXNlPHZvaWQ+IHtcbiAgY29uc3Qgc2VydmVyID0gc2VydmVUTFMob3B0aW9ucyk7XG5cbiAgZm9yIGF3YWl0IChjb25zdCByZXF1ZXN0IG9mIHNlcnZlcikge1xuICAgIGhhbmRsZXIocmVxdWVzdCk7XG4gIH1cbn1cblxuLyoqXG4gKiBJbnRlcmZhY2Ugb2YgSFRUUCBzZXJ2ZXIgcmVzcG9uc2UuXG4gKiBJZiBib2R5IGlzIGEgUmVhZGVyLCByZXNwb25zZSB3b3VsZCBiZSBjaHVua2VkLlxuICogSWYgYm9keSBpcyBhIHN0cmluZywgaXQgd291bGQgYmUgVVRGLTggZW5jb2RlZCBieSBkZWZhdWx0LlxuICovXG5leHBvcnQgaW50ZXJmYWNlIFJlc3BvbnNlIHtcbiAgc3RhdHVzPzogbnVtYmVyO1xuICBoZWFkZXJzPzogSGVhZGVycztcbiAgYm9keT86IFVpbnQ4QXJyYXkgfCBEZW5vLlJlYWRlciB8IHN0cmluZztcbiAgdHJhaWxlcnM/OiAoKSA9PiBQcm9taXNlPEhlYWRlcnM+IHwgSGVhZGVycztcbn1cbiJdfQ==