// Copyright 2018-2021 the Deno authors. All rights reserved. MIT license.
import { BufWriter } from "../io/bufio.ts";
import { TextProtoReader } from "../textproto/mod.ts";
import { assert } from "../_util/assert.ts";
import { ServerRequest } from "./server.ts";
import { STATUS_TEXT } from "./http_status.ts";
import { iter } from "../io/util.ts";
const encoder = new TextEncoder();
export function emptyReader() {
    return {
        read (_) {
            return Promise.resolve(null);
        }
    };
}
export function bodyReader(contentLength, r) {
    let totalRead = 0;
    let finished = false;
    async function read(buf) {
        if (finished) return null;
        let result;
        const remaining = contentLength - totalRead;
        if (remaining >= buf.byteLength) {
            result = await r.read(buf);
        } else {
            const readBuf = buf.subarray(0, remaining);
            result = await r.read(readBuf);
        }
        if (result !== null) {
            totalRead += result;
        }
        finished = totalRead === contentLength;
        return result;
    }
    return {
        read
    };
}
export function chunkedBodyReader(h, r) {
    // Based on https://tools.ietf.org/html/rfc2616#section-19.4.6
    const tp = new TextProtoReader(r);
    let finished = false;
    const chunks = [];
    async function read(buf) {
        if (finished) return null;
        const [chunk] = chunks;
        if (chunk) {
            const chunkRemaining = chunk.data.byteLength - chunk.offset;
            const readLength = Math.min(chunkRemaining, buf.byteLength);
            for(let i = 0; i < readLength; i++){
                buf[i] = chunk.data[chunk.offset + i];
            }
            chunk.offset += readLength;
            if (chunk.offset === chunk.data.byteLength) {
                chunks.shift();
                // Consume \r\n;
                if (await tp.readLine() === null) {
                    throw new Deno.errors.UnexpectedEof();
                }
            }
            return readLength;
        }
        const line = await tp.readLine();
        if (line === null) throw new Deno.errors.UnexpectedEof();
        // TODO(bartlomieju): handle chunk extension
        const [chunkSizeString] = line.split(";");
        const chunkSize = parseInt(chunkSizeString, 16);
        if (Number.isNaN(chunkSize) || chunkSize < 0) {
            throw new Deno.errors.InvalidData("Invalid chunk size");
        }
        if (chunkSize > 0) {
            if (chunkSize > buf.byteLength) {
                let eof = await r.readFull(buf);
                if (eof === null) {
                    throw new Deno.errors.UnexpectedEof();
                }
                const restChunk = new Uint8Array(chunkSize - buf.byteLength);
                eof = await r.readFull(restChunk);
                if (eof === null) {
                    throw new Deno.errors.UnexpectedEof();
                } else {
                    chunks.push({
                        offset: 0,
                        data: restChunk
                    });
                }
                return buf.byteLength;
            } else {
                const bufToFill = buf.subarray(0, chunkSize);
                const eof = await r.readFull(bufToFill);
                if (eof === null) {
                    throw new Deno.errors.UnexpectedEof();
                }
                // Consume \r\n
                if (await tp.readLine() === null) {
                    throw new Deno.errors.UnexpectedEof();
                }
                return chunkSize;
            }
        } else {
            assert(chunkSize === 0);
            // Consume \r\n
            if (await r.readLine() === null) {
                throw new Deno.errors.UnexpectedEof();
            }
            await readTrailers(h, r);
            finished = true;
            return null;
        }
    }
    return {
        read
    };
}
function isProhibidedForTrailer(key) {
    const s = new Set([
        "transfer-encoding",
        "content-length",
        "trailer"
    ]);
    return s.has(key.toLowerCase());
}
/** Read trailer headers from reader and append values to headers. "trailer"
 * field will be deleted. */ export async function readTrailers(headers, r) {
    const trailers = parseTrailer(headers.get("trailer"));
    if (trailers == null) return;
    const trailerNames = [
        ...trailers.keys()
    ];
    const tp = new TextProtoReader(r);
    const result = await tp.readMIMEHeader();
    if (result == null) {
        throw new Deno.errors.InvalidData("Missing trailer header.");
    }
    const undeclared = [
        ...result.keys()
    ].filter((k)=>!trailerNames.includes(k)
    );
    if (undeclared.length > 0) {
        throw new Deno.errors.InvalidData(`Undeclared trailers: ${Deno.inspect(undeclared)}.`);
    }
    for (const [k, v] of result){
        headers.append(k, v);
    }
    const missingTrailers = trailerNames.filter((k)=>!result.has(k)
    );
    if (missingTrailers.length > 0) {
        throw new Deno.errors.InvalidData(`Missing trailers: ${Deno.inspect(missingTrailers)}.`);
    }
    headers.delete("trailer");
}
function parseTrailer(field) {
    if (field == null) {
        return undefined;
    }
    const trailerNames = field.split(",").map((v)=>v.trim().toLowerCase()
    );
    if (trailerNames.length === 0) {
        throw new Deno.errors.InvalidData("Empty trailer header.");
    }
    const prohibited = trailerNames.filter((k)=>isProhibidedForTrailer(k)
    );
    if (prohibited.length > 0) {
        throw new Deno.errors.InvalidData(`Prohibited trailer names: ${Deno.inspect(prohibited)}.`);
    }
    return new Headers(trailerNames.map((key)=>[
            key,
            ""
        ]
    ));
}
export async function writeChunkedBody(w, r) {
    for await (const chunk of iter(r)){
        if (chunk.byteLength <= 0) continue;
        const start = encoder.encode(`${chunk.byteLength.toString(16)}\r\n`);
        const end = encoder.encode("\r\n");
        await w.write(start);
        await w.write(chunk);
        await w.write(end);
        await w.flush();
    }
    const endChunk = encoder.encode("0\r\n\r\n");
    await w.write(endChunk);
}
/** Write trailer headers to writer. It should mostly should be called after
 * `writeResponse()`. */ export async function writeTrailers(w, headers, trailers) {
    const trailer = headers.get("trailer");
    if (trailer === null) {
        throw new TypeError("Missing trailer header.");
    }
    const transferEncoding = headers.get("transfer-encoding");
    if (transferEncoding === null || !transferEncoding.match(/^chunked/)) {
        throw new TypeError(`Trailers are only allowed for "transfer-encoding: chunked", got "transfer-encoding: ${transferEncoding}".`);
    }
    const writer = BufWriter.create(w);
    const trailerNames = trailer.split(",").map((s)=>s.trim().toLowerCase()
    );
    const prohibitedTrailers = trailerNames.filter((k)=>isProhibidedForTrailer(k)
    );
    if (prohibitedTrailers.length > 0) {
        throw new TypeError(`Prohibited trailer names: ${Deno.inspect(prohibitedTrailers)}.`);
    }
    const undeclared = [
        ...trailers.keys()
    ].filter((k)=>!trailerNames.includes(k)
    );
    if (undeclared.length > 0) {
        throw new TypeError(`Undeclared trailers: ${Deno.inspect(undeclared)}.`);
    }
    for (const [key, value] of trailers){
        await writer.write(encoder.encode(`${key}: ${value}\r\n`));
    }
    await writer.write(encoder.encode("\r\n"));
    await writer.flush();
}
export async function writeResponse(w, r) {
    const protoMajor = 1;
    const protoMinor = 1;
    const statusCode = r.status || 200;
    const statusText = (r.statusText ?? STATUS_TEXT.get(statusCode)) ?? null;
    const writer = BufWriter.create(w);
    if (statusText === null) {
        throw new Deno.errors.InvalidData("Empty statusText (explicitely pass an empty string if this was intentional)");
    }
    if (!r.body) {
        r.body = new Uint8Array();
    }
    if (typeof r.body === "string") {
        r.body = encoder.encode(r.body);
    }
    let out = `HTTP/${protoMajor}.${protoMinor} ${statusCode} ${statusText}\r\n`;
    const headers = r.headers ?? new Headers();
    if (r.body && !headers.get("content-length")) {
        if (r.body instanceof Uint8Array) {
            out += `content-length: ${r.body.byteLength}\r\n`;
        } else if (!headers.get("transfer-encoding")) {
            out += "transfer-encoding: chunked\r\n";
        }
    }
    for (const [key, value] of headers){
        out += `${key}: ${value}\r\n`;
    }
    out += `\r\n`;
    const header = encoder.encode(out);
    const n = await writer.write(header);
    assert(n === header.byteLength);
    if (r.body instanceof Uint8Array) {
        const n = await writer.write(r.body);
        assert(n === r.body.byteLength);
    } else if (headers.has("content-length")) {
        const contentLength = headers.get("content-length");
        assert(contentLength != null);
        const bodyLength = parseInt(contentLength);
        const n = await Deno.copy(r.body, writer);
        assert(n === bodyLength);
    } else {
        await writeChunkedBody(writer, r.body);
    }
    if (r.trailers) {
        const t = await r.trailers();
        await writeTrailers(writer, headers, t);
    }
    await writer.flush();
}
/**
 * ParseHTTPVersion parses a HTTP version string.
 * "HTTP/1.0" returns (1, 0).
 * Ported from https://github.com/golang/go/blob/f5c43b9/src/net/http/request.go#L766-L792
 */ export function parseHTTPVersion(vers) {
    switch(vers){
        case "HTTP/1.1":
            return [
                1,
                1
            ];
        case "HTTP/1.0":
            return [
                1,
                0
            ];
        default:
            {
                const Big = 1000000; // arbitrary upper bound
                if (!vers.startsWith("HTTP/")) {
                    break;
                }
                const dot = vers.indexOf(".");
                if (dot < 0) {
                    break;
                }
                const majorStr = vers.substring(vers.indexOf("/") + 1, dot);
                const major = Number(majorStr);
                if (!Number.isInteger(major) || major < 0 || major > Big) {
                    break;
                }
                const minorStr = vers.substring(dot + 1);
                const minor = Number(minorStr);
                if (!Number.isInteger(minor) || minor < 0 || minor > Big) {
                    break;
                }
                return [
                    major,
                    minor
                ];
            }
    }
    throw new Error(`malformed HTTP version ${vers}`);
}
export async function readRequest(conn, bufr) {
    const tp = new TextProtoReader(bufr);
    const firstLine = await tp.readLine(); // e.g. GET /index.html HTTP/1.0
    if (firstLine === null) return null;
    const headers = await tp.readMIMEHeader();
    if (headers === null) throw new Deno.errors.UnexpectedEof();
    const req = new ServerRequest();
    req.conn = conn;
    req.r = bufr;
    [req.method, req.url, req.proto] = firstLine.split(" ", 3);
    [req.protoMajor, req.protoMinor] = parseHTTPVersion(req.proto);
    req.headers = headers;
    fixLength(req);
    return req;
}
function fixLength(req) {
    const contentLength = req.headers.get("Content-Length");
    if (contentLength) {
        const arrClen = contentLength.split(",");
        if (arrClen.length > 1) {
            const distinct = [
                ...new Set(arrClen.map((e)=>e.trim()
                ))
            ];
            if (distinct.length > 1) {
                throw Error("cannot contain multiple Content-Length headers");
            } else {
                req.headers.set("Content-Length", distinct[0]);
            }
        }
        const c = req.headers.get("Content-Length");
        if (req.method === "HEAD" && c && c !== "0") {
            throw Error("http: method cannot contain a Content-Length");
        }
        if (c && req.headers.has("transfer-encoding")) {
            // A sender MUST NOT send a Content-Length header field in any message
            // that contains a Transfer-Encoding header field.
            // rfc: https://tools.ietf.org/html/rfc7230#section-3.3.2
            throw new Error("http: Transfer-Encoding and Content-Length cannot be send together");
        }
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbImh0dHBzOi8vZGVuby5sYW5kL3N0ZEAwLjk2LjAvaHR0cC9faW8udHMiXSwic291cmNlc0NvbnRlbnQiOlsiLy8gQ29weXJpZ2h0IDIwMTgtMjAyMSB0aGUgRGVubyBhdXRob3JzLiBBbGwgcmlnaHRzIHJlc2VydmVkLiBNSVQgbGljZW5zZS5cbmltcG9ydCB7IEJ1ZlJlYWRlciwgQnVmV3JpdGVyIH0gZnJvbSBcIi4uL2lvL2J1ZmlvLnRzXCI7XG5pbXBvcnQgeyBUZXh0UHJvdG9SZWFkZXIgfSBmcm9tIFwiLi4vdGV4dHByb3RvL21vZC50c1wiO1xuaW1wb3J0IHsgYXNzZXJ0IH0gZnJvbSBcIi4uL191dGlsL2Fzc2VydC50c1wiO1xuaW1wb3J0IHsgUmVzcG9uc2UsIFNlcnZlclJlcXVlc3QgfSBmcm9tIFwiLi9zZXJ2ZXIudHNcIjtcbmltcG9ydCB7IFNUQVRVU19URVhUIH0gZnJvbSBcIi4vaHR0cF9zdGF0dXMudHNcIjtcbmltcG9ydCB7IGl0ZXIgfSBmcm9tIFwiLi4vaW8vdXRpbC50c1wiO1xuXG5jb25zdCBlbmNvZGVyID0gbmV3IFRleHRFbmNvZGVyKCk7XG5cbmV4cG9ydCBmdW5jdGlvbiBlbXB0eVJlYWRlcigpOiBEZW5vLlJlYWRlciB7XG4gIHJldHVybiB7XG4gICAgcmVhZChfOiBVaW50OEFycmF5KTogUHJvbWlzZTxudW1iZXIgfCBudWxsPiB7XG4gICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKG51bGwpO1xuICAgIH0sXG4gIH07XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBib2R5UmVhZGVyKGNvbnRlbnRMZW5ndGg6IG51bWJlciwgcjogQnVmUmVhZGVyKTogRGVuby5SZWFkZXIge1xuICBsZXQgdG90YWxSZWFkID0gMDtcbiAgbGV0IGZpbmlzaGVkID0gZmFsc2U7XG4gIGFzeW5jIGZ1bmN0aW9uIHJlYWQoYnVmOiBVaW50OEFycmF5KTogUHJvbWlzZTxudW1iZXIgfCBudWxsPiB7XG4gICAgaWYgKGZpbmlzaGVkKSByZXR1cm4gbnVsbDtcbiAgICBsZXQgcmVzdWx0OiBudW1iZXIgfCBudWxsO1xuICAgIGNvbnN0IHJlbWFpbmluZyA9IGNvbnRlbnRMZW5ndGggLSB0b3RhbFJlYWQ7XG4gICAgaWYgKHJlbWFpbmluZyA+PSBidWYuYnl0ZUxlbmd0aCkge1xuICAgICAgcmVzdWx0ID0gYXdhaXQgci5yZWFkKGJ1Zik7XG4gICAgfSBlbHNlIHtcbiAgICAgIGNvbnN0IHJlYWRCdWYgPSBidWYuc3ViYXJyYXkoMCwgcmVtYWluaW5nKTtcbiAgICAgIHJlc3VsdCA9IGF3YWl0IHIucmVhZChyZWFkQnVmKTtcbiAgICB9XG4gICAgaWYgKHJlc3VsdCAhPT0gbnVsbCkge1xuICAgICAgdG90YWxSZWFkICs9IHJlc3VsdDtcbiAgICB9XG4gICAgZmluaXNoZWQgPSB0b3RhbFJlYWQgPT09IGNvbnRlbnRMZW5ndGg7XG4gICAgcmV0dXJuIHJlc3VsdDtcbiAgfVxuICByZXR1cm4geyByZWFkIH07XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBjaHVua2VkQm9keVJlYWRlcihoOiBIZWFkZXJzLCByOiBCdWZSZWFkZXIpOiBEZW5vLlJlYWRlciB7XG4gIC8vIEJhc2VkIG9uIGh0dHBzOi8vdG9vbHMuaWV0Zi5vcmcvaHRtbC9yZmMyNjE2I3NlY3Rpb24tMTkuNC42XG4gIGNvbnN0IHRwID0gbmV3IFRleHRQcm90b1JlYWRlcihyKTtcbiAgbGV0IGZpbmlzaGVkID0gZmFsc2U7XG4gIGNvbnN0IGNodW5rczogQXJyYXk8e1xuICAgIG9mZnNldDogbnVtYmVyO1xuICAgIGRhdGE6IFVpbnQ4QXJyYXk7XG4gIH0+ID0gW107XG4gIGFzeW5jIGZ1bmN0aW9uIHJlYWQoYnVmOiBVaW50OEFycmF5KTogUHJvbWlzZTxudW1iZXIgfCBudWxsPiB7XG4gICAgaWYgKGZpbmlzaGVkKSByZXR1cm4gbnVsbDtcbiAgICBjb25zdCBbY2h1bmtdID0gY2h1bmtzO1xuICAgIGlmIChjaHVuaykge1xuICAgICAgY29uc3QgY2h1bmtSZW1haW5pbmcgPSBjaHVuay5kYXRhLmJ5dGVMZW5ndGggLSBjaHVuay5vZmZzZXQ7XG4gICAgICBjb25zdCByZWFkTGVuZ3RoID0gTWF0aC5taW4oY2h1bmtSZW1haW5pbmcsIGJ1Zi5ieXRlTGVuZ3RoKTtcbiAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgcmVhZExlbmd0aDsgaSsrKSB7XG4gICAgICAgIGJ1ZltpXSA9IGNodW5rLmRhdGFbY2h1bmsub2Zmc2V0ICsgaV07XG4gICAgICB9XG4gICAgICBjaHVuay5vZmZzZXQgKz0gcmVhZExlbmd0aDtcbiAgICAgIGlmIChjaHVuay5vZmZzZXQgPT09IGNodW5rLmRhdGEuYnl0ZUxlbmd0aCkge1xuICAgICAgICBjaHVua3Muc2hpZnQoKTtcbiAgICAgICAgLy8gQ29uc3VtZSBcXHJcXG47XG4gICAgICAgIGlmICgoYXdhaXQgdHAucmVhZExpbmUoKSkgPT09IG51bGwpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRGVuby5lcnJvcnMuVW5leHBlY3RlZEVvZigpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICByZXR1cm4gcmVhZExlbmd0aDtcbiAgICB9XG4gICAgY29uc3QgbGluZSA9IGF3YWl0IHRwLnJlYWRMaW5lKCk7XG4gICAgaWYgKGxpbmUgPT09IG51bGwpIHRocm93IG5ldyBEZW5vLmVycm9ycy5VbmV4cGVjdGVkRW9mKCk7XG4gICAgLy8gVE9ETyhiYXJ0bG9taWVqdSk6IGhhbmRsZSBjaHVuayBleHRlbnNpb25cbiAgICBjb25zdCBbY2h1bmtTaXplU3RyaW5nXSA9IGxpbmUuc3BsaXQoXCI7XCIpO1xuICAgIGNvbnN0IGNodW5rU2l6ZSA9IHBhcnNlSW50KGNodW5rU2l6ZVN0cmluZywgMTYpO1xuICAgIGlmIChOdW1iZXIuaXNOYU4oY2h1bmtTaXplKSB8fCBjaHVua1NpemUgPCAwKSB7XG4gICAgICB0aHJvdyBuZXcgRGVuby5lcnJvcnMuSW52YWxpZERhdGEoXCJJbnZhbGlkIGNodW5rIHNpemVcIik7XG4gICAgfVxuICAgIGlmIChjaHVua1NpemUgPiAwKSB7XG4gICAgICBpZiAoY2h1bmtTaXplID4gYnVmLmJ5dGVMZW5ndGgpIHtcbiAgICAgICAgbGV0IGVvZiA9IGF3YWl0IHIucmVhZEZ1bGwoYnVmKTtcbiAgICAgICAgaWYgKGVvZiA9PT0gbnVsbCkge1xuICAgICAgICAgIHRocm93IG5ldyBEZW5vLmVycm9ycy5VbmV4cGVjdGVkRW9mKCk7XG4gICAgICAgIH1cbiAgICAgICAgY29uc3QgcmVzdENodW5rID0gbmV3IFVpbnQ4QXJyYXkoY2h1bmtTaXplIC0gYnVmLmJ5dGVMZW5ndGgpO1xuICAgICAgICBlb2YgPSBhd2FpdCByLnJlYWRGdWxsKHJlc3RDaHVuayk7XG4gICAgICAgIGlmIChlb2YgPT09IG51bGwpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRGVuby5lcnJvcnMuVW5leHBlY3RlZEVvZigpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGNodW5rcy5wdXNoKHtcbiAgICAgICAgICAgIG9mZnNldDogMCxcbiAgICAgICAgICAgIGRhdGE6IHJlc3RDaHVuayxcbiAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gYnVmLmJ5dGVMZW5ndGg7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBjb25zdCBidWZUb0ZpbGwgPSBidWYuc3ViYXJyYXkoMCwgY2h1bmtTaXplKTtcbiAgICAgICAgY29uc3QgZW9mID0gYXdhaXQgci5yZWFkRnVsbChidWZUb0ZpbGwpO1xuICAgICAgICBpZiAoZW9mID09PSBudWxsKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IERlbm8uZXJyb3JzLlVuZXhwZWN0ZWRFb2YoKTtcbiAgICAgICAgfVxuICAgICAgICAvLyBDb25zdW1lIFxcclxcblxuICAgICAgICBpZiAoKGF3YWl0IHRwLnJlYWRMaW5lKCkpID09PSBudWxsKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IERlbm8uZXJyb3JzLlVuZXhwZWN0ZWRFb2YoKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gY2h1bmtTaXplO1xuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICBhc3NlcnQoY2h1bmtTaXplID09PSAwKTtcbiAgICAgIC8vIENvbnN1bWUgXFxyXFxuXG4gICAgICBpZiAoKGF3YWl0IHIucmVhZExpbmUoKSkgPT09IG51bGwpIHtcbiAgICAgICAgdGhyb3cgbmV3IERlbm8uZXJyb3JzLlVuZXhwZWN0ZWRFb2YoKTtcbiAgICAgIH1cbiAgICAgIGF3YWl0IHJlYWRUcmFpbGVycyhoLCByKTtcbiAgICAgIGZpbmlzaGVkID0gdHJ1ZTtcbiAgICAgIHJldHVybiBudWxsO1xuICAgIH1cbiAgfVxuICByZXR1cm4geyByZWFkIH07XG59XG5cbmZ1bmN0aW9uIGlzUHJvaGliaWRlZEZvclRyYWlsZXIoa2V5OiBzdHJpbmcpOiBib29sZWFuIHtcbiAgY29uc3QgcyA9IG5ldyBTZXQoW1widHJhbnNmZXItZW5jb2RpbmdcIiwgXCJjb250ZW50LWxlbmd0aFwiLCBcInRyYWlsZXJcIl0pO1xuICByZXR1cm4gcy5oYXMoa2V5LnRvTG93ZXJDYXNlKCkpO1xufVxuXG4vKiogUmVhZCB0cmFpbGVyIGhlYWRlcnMgZnJvbSByZWFkZXIgYW5kIGFwcGVuZCB2YWx1ZXMgdG8gaGVhZGVycy4gXCJ0cmFpbGVyXCJcbiAqIGZpZWxkIHdpbGwgYmUgZGVsZXRlZC4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiByZWFkVHJhaWxlcnMoXG4gIGhlYWRlcnM6IEhlYWRlcnMsXG4gIHI6IEJ1ZlJlYWRlcixcbikge1xuICBjb25zdCB0cmFpbGVycyA9IHBhcnNlVHJhaWxlcihoZWFkZXJzLmdldChcInRyYWlsZXJcIikpO1xuICBpZiAodHJhaWxlcnMgPT0gbnVsbCkgcmV0dXJuO1xuICBjb25zdCB0cmFpbGVyTmFtZXMgPSBbLi4udHJhaWxlcnMua2V5cygpXTtcbiAgY29uc3QgdHAgPSBuZXcgVGV4dFByb3RvUmVhZGVyKHIpO1xuICBjb25zdCByZXN1bHQgPSBhd2FpdCB0cC5yZWFkTUlNRUhlYWRlcigpO1xuICBpZiAocmVzdWx0ID09IG51bGwpIHtcbiAgICB0aHJvdyBuZXcgRGVuby5lcnJvcnMuSW52YWxpZERhdGEoXCJNaXNzaW5nIHRyYWlsZXIgaGVhZGVyLlwiKTtcbiAgfVxuICBjb25zdCB1bmRlY2xhcmVkID0gWy4uLnJlc3VsdC5rZXlzKCldLmZpbHRlcihcbiAgICAoaykgPT4gIXRyYWlsZXJOYW1lcy5pbmNsdWRlcyhrKSxcbiAgKTtcbiAgaWYgKHVuZGVjbGFyZWQubGVuZ3RoID4gMCkge1xuICAgIHRocm93IG5ldyBEZW5vLmVycm9ycy5JbnZhbGlkRGF0YShcbiAgICAgIGBVbmRlY2xhcmVkIHRyYWlsZXJzOiAke0Rlbm8uaW5zcGVjdCh1bmRlY2xhcmVkKX0uYCxcbiAgICApO1xuICB9XG4gIGZvciAoY29uc3QgW2ssIHZdIG9mIHJlc3VsdCkge1xuICAgIGhlYWRlcnMuYXBwZW5kKGssIHYpO1xuICB9XG4gIGNvbnN0IG1pc3NpbmdUcmFpbGVycyA9IHRyYWlsZXJOYW1lcy5maWx0ZXIoKGspID0+ICFyZXN1bHQuaGFzKGspKTtcbiAgaWYgKG1pc3NpbmdUcmFpbGVycy5sZW5ndGggPiAwKSB7XG4gICAgdGhyb3cgbmV3IERlbm8uZXJyb3JzLkludmFsaWREYXRhKFxuICAgICAgYE1pc3NpbmcgdHJhaWxlcnM6ICR7RGVuby5pbnNwZWN0KG1pc3NpbmdUcmFpbGVycyl9LmAsXG4gICAgKTtcbiAgfVxuICBoZWFkZXJzLmRlbGV0ZShcInRyYWlsZXJcIik7XG59XG5cbmZ1bmN0aW9uIHBhcnNlVHJhaWxlcihmaWVsZDogc3RyaW5nIHwgbnVsbCk6IEhlYWRlcnMgfCB1bmRlZmluZWQge1xuICBpZiAoZmllbGQgPT0gbnVsbCkge1xuICAgIHJldHVybiB1bmRlZmluZWQ7XG4gIH1cbiAgY29uc3QgdHJhaWxlck5hbWVzID0gZmllbGQuc3BsaXQoXCIsXCIpLm1hcCgodikgPT4gdi50cmltKCkudG9Mb3dlckNhc2UoKSk7XG4gIGlmICh0cmFpbGVyTmFtZXMubGVuZ3RoID09PSAwKSB7XG4gICAgdGhyb3cgbmV3IERlbm8uZXJyb3JzLkludmFsaWREYXRhKFwiRW1wdHkgdHJhaWxlciBoZWFkZXIuXCIpO1xuICB9XG4gIGNvbnN0IHByb2hpYml0ZWQgPSB0cmFpbGVyTmFtZXMuZmlsdGVyKChrKSA9PiBpc1Byb2hpYmlkZWRGb3JUcmFpbGVyKGspKTtcbiAgaWYgKHByb2hpYml0ZWQubGVuZ3RoID4gMCkge1xuICAgIHRocm93IG5ldyBEZW5vLmVycm9ycy5JbnZhbGlkRGF0YShcbiAgICAgIGBQcm9oaWJpdGVkIHRyYWlsZXIgbmFtZXM6ICR7RGVuby5pbnNwZWN0KHByb2hpYml0ZWQpfS5gLFxuICAgICk7XG4gIH1cbiAgcmV0dXJuIG5ldyBIZWFkZXJzKHRyYWlsZXJOYW1lcy5tYXAoKGtleSkgPT4gW2tleSwgXCJcIl0pKTtcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHdyaXRlQ2h1bmtlZEJvZHkoXG4gIHc6IEJ1ZldyaXRlcixcbiAgcjogRGVuby5SZWFkZXIsXG4pIHtcbiAgZm9yIGF3YWl0IChjb25zdCBjaHVuayBvZiBpdGVyKHIpKSB7XG4gICAgaWYgKGNodW5rLmJ5dGVMZW5ndGggPD0gMCkgY29udGludWU7XG4gICAgY29uc3Qgc3RhcnQgPSBlbmNvZGVyLmVuY29kZShgJHtjaHVuay5ieXRlTGVuZ3RoLnRvU3RyaW5nKDE2KX1cXHJcXG5gKTtcbiAgICBjb25zdCBlbmQgPSBlbmNvZGVyLmVuY29kZShcIlxcclxcblwiKTtcbiAgICBhd2FpdCB3LndyaXRlKHN0YXJ0KTtcbiAgICBhd2FpdCB3LndyaXRlKGNodW5rKTtcbiAgICBhd2FpdCB3LndyaXRlKGVuZCk7XG4gICAgYXdhaXQgdy5mbHVzaCgpO1xuICB9XG5cbiAgY29uc3QgZW5kQ2h1bmsgPSBlbmNvZGVyLmVuY29kZShcIjBcXHJcXG5cXHJcXG5cIik7XG4gIGF3YWl0IHcud3JpdGUoZW5kQ2h1bmspO1xufVxuXG4vKiogV3JpdGUgdHJhaWxlciBoZWFkZXJzIHRvIHdyaXRlci4gSXQgc2hvdWxkIG1vc3RseSBzaG91bGQgYmUgY2FsbGVkIGFmdGVyXG4gKiBgd3JpdGVSZXNwb25zZSgpYC4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiB3cml0ZVRyYWlsZXJzKFxuICB3OiBEZW5vLldyaXRlcixcbiAgaGVhZGVyczogSGVhZGVycyxcbiAgdHJhaWxlcnM6IEhlYWRlcnMsXG4pIHtcbiAgY29uc3QgdHJhaWxlciA9IGhlYWRlcnMuZ2V0KFwidHJhaWxlclwiKTtcbiAgaWYgKHRyYWlsZXIgPT09IG51bGwpIHtcbiAgICB0aHJvdyBuZXcgVHlwZUVycm9yKFwiTWlzc2luZyB0cmFpbGVyIGhlYWRlci5cIik7XG4gIH1cbiAgY29uc3QgdHJhbnNmZXJFbmNvZGluZyA9IGhlYWRlcnMuZ2V0KFwidHJhbnNmZXItZW5jb2RpbmdcIik7XG4gIGlmICh0cmFuc2ZlckVuY29kaW5nID09PSBudWxsIHx8ICF0cmFuc2ZlckVuY29kaW5nLm1hdGNoKC9eY2h1bmtlZC8pKSB7XG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvcihcbiAgICAgIGBUcmFpbGVycyBhcmUgb25seSBhbGxvd2VkIGZvciBcInRyYW5zZmVyLWVuY29kaW5nOiBjaHVua2VkXCIsIGdvdCBcInRyYW5zZmVyLWVuY29kaW5nOiAke3RyYW5zZmVyRW5jb2Rpbmd9XCIuYCxcbiAgICApO1xuICB9XG4gIGNvbnN0IHdyaXRlciA9IEJ1ZldyaXRlci5jcmVhdGUodyk7XG4gIGNvbnN0IHRyYWlsZXJOYW1lcyA9IHRyYWlsZXIuc3BsaXQoXCIsXCIpLm1hcCgocykgPT4gcy50cmltKCkudG9Mb3dlckNhc2UoKSk7XG4gIGNvbnN0IHByb2hpYml0ZWRUcmFpbGVycyA9IHRyYWlsZXJOYW1lcy5maWx0ZXIoKGspID0+XG4gICAgaXNQcm9oaWJpZGVkRm9yVHJhaWxlcihrKVxuICApO1xuICBpZiAocHJvaGliaXRlZFRyYWlsZXJzLmxlbmd0aCA+IDApIHtcbiAgICB0aHJvdyBuZXcgVHlwZUVycm9yKFxuICAgICAgYFByb2hpYml0ZWQgdHJhaWxlciBuYW1lczogJHtEZW5vLmluc3BlY3QocHJvaGliaXRlZFRyYWlsZXJzKX0uYCxcbiAgICApO1xuICB9XG4gIGNvbnN0IHVuZGVjbGFyZWQgPSBbLi4udHJhaWxlcnMua2V5cygpXS5maWx0ZXIoXG4gICAgKGspID0+ICF0cmFpbGVyTmFtZXMuaW5jbHVkZXMoayksXG4gICk7XG4gIGlmICh1bmRlY2xhcmVkLmxlbmd0aCA+IDApIHtcbiAgICB0aHJvdyBuZXcgVHlwZUVycm9yKGBVbmRlY2xhcmVkIHRyYWlsZXJzOiAke0Rlbm8uaW5zcGVjdCh1bmRlY2xhcmVkKX0uYCk7XG4gIH1cbiAgZm9yIChjb25zdCBba2V5LCB2YWx1ZV0gb2YgdHJhaWxlcnMpIHtcbiAgICBhd2FpdCB3cml0ZXIud3JpdGUoZW5jb2Rlci5lbmNvZGUoYCR7a2V5fTogJHt2YWx1ZX1cXHJcXG5gKSk7XG4gIH1cbiAgYXdhaXQgd3JpdGVyLndyaXRlKGVuY29kZXIuZW5jb2RlKFwiXFxyXFxuXCIpKTtcbiAgYXdhaXQgd3JpdGVyLmZsdXNoKCk7XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiB3cml0ZVJlc3BvbnNlKFxuICB3OiBEZW5vLldyaXRlcixcbiAgcjogUmVzcG9uc2UsXG4pIHtcbiAgY29uc3QgcHJvdG9NYWpvciA9IDE7XG4gIGNvbnN0IHByb3RvTWlub3IgPSAxO1xuICBjb25zdCBzdGF0dXNDb2RlID0gci5zdGF0dXMgfHwgMjAwO1xuICBjb25zdCBzdGF0dXNUZXh0ID0gci5zdGF0dXNUZXh0ID8/IFNUQVRVU19URVhULmdldChzdGF0dXNDb2RlKSA/PyBudWxsO1xuICBjb25zdCB3cml0ZXIgPSBCdWZXcml0ZXIuY3JlYXRlKHcpO1xuICBpZiAoc3RhdHVzVGV4dCA9PT0gbnVsbCkge1xuICAgIHRocm93IG5ldyBEZW5vLmVycm9ycy5JbnZhbGlkRGF0YShcbiAgICAgIFwiRW1wdHkgc3RhdHVzVGV4dCAoZXhwbGljaXRlbHkgcGFzcyBhbiBlbXB0eSBzdHJpbmcgaWYgdGhpcyB3YXMgaW50ZW50aW9uYWwpXCIsXG4gICAgKTtcbiAgfVxuICBpZiAoIXIuYm9keSkge1xuICAgIHIuYm9keSA9IG5ldyBVaW50OEFycmF5KCk7XG4gIH1cbiAgaWYgKHR5cGVvZiByLmJvZHkgPT09IFwic3RyaW5nXCIpIHtcbiAgICByLmJvZHkgPSBlbmNvZGVyLmVuY29kZShyLmJvZHkpO1xuICB9XG5cbiAgbGV0IG91dCA9IGBIVFRQLyR7cHJvdG9NYWpvcn0uJHtwcm90b01pbm9yfSAke3N0YXR1c0NvZGV9ICR7c3RhdHVzVGV4dH1cXHJcXG5gO1xuXG4gIGNvbnN0IGhlYWRlcnMgPSByLmhlYWRlcnMgPz8gbmV3IEhlYWRlcnMoKTtcblxuICBpZiAoci5ib2R5ICYmICFoZWFkZXJzLmdldChcImNvbnRlbnQtbGVuZ3RoXCIpKSB7XG4gICAgaWYgKHIuYm9keSBpbnN0YW5jZW9mIFVpbnQ4QXJyYXkpIHtcbiAgICAgIG91dCArPSBgY29udGVudC1sZW5ndGg6ICR7ci5ib2R5LmJ5dGVMZW5ndGh9XFxyXFxuYDtcbiAgICB9IGVsc2UgaWYgKCFoZWFkZXJzLmdldChcInRyYW5zZmVyLWVuY29kaW5nXCIpKSB7XG4gICAgICBvdXQgKz0gXCJ0cmFuc2Zlci1lbmNvZGluZzogY2h1bmtlZFxcclxcblwiO1xuICAgIH1cbiAgfVxuXG4gIGZvciAoY29uc3QgW2tleSwgdmFsdWVdIG9mIGhlYWRlcnMpIHtcbiAgICBvdXQgKz0gYCR7a2V5fTogJHt2YWx1ZX1cXHJcXG5gO1xuICB9XG5cbiAgb3V0ICs9IGBcXHJcXG5gO1xuXG4gIGNvbnN0IGhlYWRlciA9IGVuY29kZXIuZW5jb2RlKG91dCk7XG4gIGNvbnN0IG4gPSBhd2FpdCB3cml0ZXIud3JpdGUoaGVhZGVyKTtcbiAgYXNzZXJ0KG4gPT09IGhlYWRlci5ieXRlTGVuZ3RoKTtcblxuICBpZiAoci5ib2R5IGluc3RhbmNlb2YgVWludDhBcnJheSkge1xuICAgIGNvbnN0IG4gPSBhd2FpdCB3cml0ZXIud3JpdGUoci5ib2R5KTtcbiAgICBhc3NlcnQobiA9PT0gci5ib2R5LmJ5dGVMZW5ndGgpO1xuICB9IGVsc2UgaWYgKGhlYWRlcnMuaGFzKFwiY29udGVudC1sZW5ndGhcIikpIHtcbiAgICBjb25zdCBjb250ZW50TGVuZ3RoID0gaGVhZGVycy5nZXQoXCJjb250ZW50LWxlbmd0aFwiKTtcbiAgICBhc3NlcnQoY29udGVudExlbmd0aCAhPSBudWxsKTtcbiAgICBjb25zdCBib2R5TGVuZ3RoID0gcGFyc2VJbnQoY29udGVudExlbmd0aCk7XG4gICAgY29uc3QgbiA9IGF3YWl0IERlbm8uY29weShyLmJvZHksIHdyaXRlcik7XG4gICAgYXNzZXJ0KG4gPT09IGJvZHlMZW5ndGgpO1xuICB9IGVsc2Uge1xuICAgIGF3YWl0IHdyaXRlQ2h1bmtlZEJvZHkod3JpdGVyLCByLmJvZHkpO1xuICB9XG4gIGlmIChyLnRyYWlsZXJzKSB7XG4gICAgY29uc3QgdCA9IGF3YWl0IHIudHJhaWxlcnMoKTtcbiAgICBhd2FpdCB3cml0ZVRyYWlsZXJzKHdyaXRlciwgaGVhZGVycywgdCk7XG4gIH1cbiAgYXdhaXQgd3JpdGVyLmZsdXNoKCk7XG59XG5cbi8qKlxuICogUGFyc2VIVFRQVmVyc2lvbiBwYXJzZXMgYSBIVFRQIHZlcnNpb24gc3RyaW5nLlxuICogXCJIVFRQLzEuMFwiIHJldHVybnMgKDEsIDApLlxuICogUG9ydGVkIGZyb20gaHR0cHM6Ly9naXRodWIuY29tL2dvbGFuZy9nby9ibG9iL2Y1YzQzYjkvc3JjL25ldC9odHRwL3JlcXVlc3QuZ28jTDc2Ni1MNzkyXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwYXJzZUhUVFBWZXJzaW9uKHZlcnM6IHN0cmluZyk6IFtudW1iZXIsIG51bWJlcl0ge1xuICBzd2l0Y2ggKHZlcnMpIHtcbiAgICBjYXNlIFwiSFRUUC8xLjFcIjpcbiAgICAgIHJldHVybiBbMSwgMV07XG5cbiAgICBjYXNlIFwiSFRUUC8xLjBcIjpcbiAgICAgIHJldHVybiBbMSwgMF07XG5cbiAgICBkZWZhdWx0OiB7XG4gICAgICBjb25zdCBCaWcgPSAxMDAwMDAwOyAvLyBhcmJpdHJhcnkgdXBwZXIgYm91bmRcblxuICAgICAgaWYgKCF2ZXJzLnN0YXJ0c1dpdGgoXCJIVFRQL1wiKSkge1xuICAgICAgICBicmVhaztcbiAgICAgIH1cblxuICAgICAgY29uc3QgZG90ID0gdmVycy5pbmRleE9mKFwiLlwiKTtcbiAgICAgIGlmIChkb3QgPCAwKSB7XG4gICAgICAgIGJyZWFrO1xuICAgICAgfVxuXG4gICAgICBjb25zdCBtYWpvclN0ciA9IHZlcnMuc3Vic3RyaW5nKHZlcnMuaW5kZXhPZihcIi9cIikgKyAxLCBkb3QpO1xuICAgICAgY29uc3QgbWFqb3IgPSBOdW1iZXIobWFqb3JTdHIpO1xuICAgICAgaWYgKCFOdW1iZXIuaXNJbnRlZ2VyKG1ham9yKSB8fCBtYWpvciA8IDAgfHwgbWFqb3IgPiBCaWcpIHtcbiAgICAgICAgYnJlYWs7XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IG1pbm9yU3RyID0gdmVycy5zdWJzdHJpbmcoZG90ICsgMSk7XG4gICAgICBjb25zdCBtaW5vciA9IE51bWJlcihtaW5vclN0cik7XG4gICAgICBpZiAoIU51bWJlci5pc0ludGVnZXIobWlub3IpIHx8IG1pbm9yIDwgMCB8fCBtaW5vciA+IEJpZykge1xuICAgICAgICBicmVhaztcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIFttYWpvciwgbWlub3JdO1xuICAgIH1cbiAgfVxuXG4gIHRocm93IG5ldyBFcnJvcihgbWFsZm9ybWVkIEhUVFAgdmVyc2lvbiAke3ZlcnN9YCk7XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiByZWFkUmVxdWVzdChcbiAgY29ubjogRGVuby5Db25uLFxuICBidWZyOiBCdWZSZWFkZXIsXG4pOiBQcm9taXNlPFNlcnZlclJlcXVlc3QgfCBudWxsPiB7XG4gIGNvbnN0IHRwID0gbmV3IFRleHRQcm90b1JlYWRlcihidWZyKTtcbiAgY29uc3QgZmlyc3RMaW5lID0gYXdhaXQgdHAucmVhZExpbmUoKTsgLy8gZS5nLiBHRVQgL2luZGV4Lmh0bWwgSFRUUC8xLjBcbiAgaWYgKGZpcnN0TGluZSA9PT0gbnVsbCkgcmV0dXJuIG51bGw7XG4gIGNvbnN0IGhlYWRlcnMgPSBhd2FpdCB0cC5yZWFkTUlNRUhlYWRlcigpO1xuICBpZiAoaGVhZGVycyA9PT0gbnVsbCkgdGhyb3cgbmV3IERlbm8uZXJyb3JzLlVuZXhwZWN0ZWRFb2YoKTtcblxuICBjb25zdCByZXEgPSBuZXcgU2VydmVyUmVxdWVzdCgpO1xuICByZXEuY29ubiA9IGNvbm47XG4gIHJlcS5yID0gYnVmcjtcbiAgW3JlcS5tZXRob2QsIHJlcS51cmwsIHJlcS5wcm90b10gPSBmaXJzdExpbmUuc3BsaXQoXCIgXCIsIDMpO1xuICBbcmVxLnByb3RvTWFqb3IsIHJlcS5wcm90b01pbm9yXSA9IHBhcnNlSFRUUFZlcnNpb24ocmVxLnByb3RvKTtcbiAgcmVxLmhlYWRlcnMgPSBoZWFkZXJzO1xuICBmaXhMZW5ndGgocmVxKTtcbiAgcmV0dXJuIHJlcTtcbn1cblxuZnVuY3Rpb24gZml4TGVuZ3RoKHJlcTogU2VydmVyUmVxdWVzdCk6IHZvaWQge1xuICBjb25zdCBjb250ZW50TGVuZ3RoID0gcmVxLmhlYWRlcnMuZ2V0KFwiQ29udGVudC1MZW5ndGhcIik7XG4gIGlmIChjb250ZW50TGVuZ3RoKSB7XG4gICAgY29uc3QgYXJyQ2xlbiA9IGNvbnRlbnRMZW5ndGguc3BsaXQoXCIsXCIpO1xuICAgIGlmIChhcnJDbGVuLmxlbmd0aCA+IDEpIHtcbiAgICAgIGNvbnN0IGRpc3RpbmN0ID0gWy4uLm5ldyBTZXQoYXJyQ2xlbi5tYXAoKGUpOiBzdHJpbmcgPT4gZS50cmltKCkpKV07XG4gICAgICBpZiAoZGlzdGluY3QubGVuZ3RoID4gMSkge1xuICAgICAgICB0aHJvdyBFcnJvcihcImNhbm5vdCBjb250YWluIG11bHRpcGxlIENvbnRlbnQtTGVuZ3RoIGhlYWRlcnNcIik7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICByZXEuaGVhZGVycy5zZXQoXCJDb250ZW50LUxlbmd0aFwiLCBkaXN0aW5jdFswXSk7XG4gICAgICB9XG4gICAgfVxuICAgIGNvbnN0IGMgPSByZXEuaGVhZGVycy5nZXQoXCJDb250ZW50LUxlbmd0aFwiKTtcbiAgICBpZiAocmVxLm1ldGhvZCA9PT0gXCJIRUFEXCIgJiYgYyAmJiBjICE9PSBcIjBcIikge1xuICAgICAgdGhyb3cgRXJyb3IoXCJodHRwOiBtZXRob2QgY2Fubm90IGNvbnRhaW4gYSBDb250ZW50LUxlbmd0aFwiKTtcbiAgICB9XG4gICAgaWYgKGMgJiYgcmVxLmhlYWRlcnMuaGFzKFwidHJhbnNmZXItZW5jb2RpbmdcIikpIHtcbiAgICAgIC8vIEEgc2VuZGVyIE1VU1QgTk9UIHNlbmQgYSBDb250ZW50LUxlbmd0aCBoZWFkZXIgZmllbGQgaW4gYW55IG1lc3NhZ2VcbiAgICAgIC8vIHRoYXQgY29udGFpbnMgYSBUcmFuc2Zlci1FbmNvZGluZyBoZWFkZXIgZmllbGQuXG4gICAgICAvLyByZmM6IGh0dHBzOi8vdG9vbHMuaWV0Zi5vcmcvaHRtbC9yZmM3MjMwI3NlY3Rpb24tMy4zLjJcbiAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgXCJodHRwOiBUcmFuc2Zlci1FbmNvZGluZyBhbmQgQ29udGVudC1MZW5ndGggY2Fubm90IGJlIHNlbmQgdG9nZXRoZXJcIixcbiAgICAgICk7XG4gICAgfVxuICB9XG59XG4iXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsRUFBMEUsQUFBMUUsd0VBQTBFO0FBQzFFLE1BQU0sR0FBYyxTQUFTLFFBQVEsQ0FBZ0I7QUFDckQsTUFBTSxHQUFHLGVBQWUsUUFBUSxDQUFxQjtBQUNyRCxNQUFNLEdBQUcsTUFBTSxRQUFRLENBQW9CO0FBQzNDLE1BQU0sR0FBYSxhQUFhLFFBQVEsQ0FBYTtBQUNyRCxNQUFNLEdBQUcsV0FBVyxRQUFRLENBQWtCO0FBQzlDLE1BQU0sR0FBRyxJQUFJLFFBQVEsQ0FBZTtBQUVwQyxLQUFLLENBQUMsT0FBTyxHQUFHLEdBQUcsQ0FBQyxXQUFXO0FBRS9CLE1BQU0sVUFBVSxXQUFXLEdBQWdCLENBQUM7SUFDMUMsTUFBTSxDQUFDLENBQUM7UUFDTixJQUFJ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