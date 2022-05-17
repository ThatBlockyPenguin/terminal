import { copy } from "../bytes/mod.ts";
import { assert } from "../_util/assert.ts";
import { BytesList } from "../bytes/bytes_list.ts";
import { writeAll, writeAllSync } from "./util.ts";
const DEFAULT_BUF_SIZE = 4096;
const MIN_BUF_SIZE = 16;
const MAX_CONSECUTIVE_EMPTY_READS = 100;
const CR = "\r".charCodeAt(0);
const LF = "\n".charCodeAt(0);
export class BufferFullError extends Error {
    partial;
    name = "BufferFullError";
    constructor(partial){
        super("Buffer full");
        this.partial = partial;
    }
}
export class PartialReadError extends Error {
    name = "PartialReadError";
    partial;
    constructor(){
        super("Encountered UnexpectedEof, data only partially read");
    }
}
/** BufReader implements buffering for a Reader object. */ export class BufReader {
    buf;
    rd;
    r = 0;
    w = 0;
    eof = false;
    // private lastByte: number;
    // private lastCharSize: number;
    /** return new BufReader unless r is BufReader */ static create(r, size = DEFAULT_BUF_SIZE) {
        return r instanceof BufReader ? r : new BufReader(r, size);
    }
    constructor(rd, size = DEFAULT_BUF_SIZE){
        if (size < MIN_BUF_SIZE) {
            size = MIN_BUF_SIZE;
        }
        this._reset(new Uint8Array(size), rd);
    }
    /** Returns the size of the underlying buffer in bytes. */ size() {
        return this.buf.byteLength;
    }
    buffered() {
        return this.w - this.r;
    }
    // Reads a new chunk into the buffer.
    async _fill() {
        // Slide existing data to beginning.
        if (this.r > 0) {
            this.buf.copyWithin(0, this.r, this.w);
            this.w -= this.r;
            this.r = 0;
        }
        if (this.w >= this.buf.byteLength) {
            throw Error("bufio: tried to fill full buffer");
        }
        // Read new data: try a limited number of times.
        for(let i = MAX_CONSECUTIVE_EMPTY_READS; i > 0; i--){
            const rr = await this.rd.read(this.buf.subarray(this.w));
            if (rr === null) {
                this.eof = true;
                return;
            }
            assert(rr >= 0, "negative read");
            this.w += rr;
            if (rr > 0) {
                return;
            }
        }
        throw new Error(`No progress after ${MAX_CONSECUTIVE_EMPTY_READS} read() calls`);
    }
    /** Discards any buffered data, resets all state, and switches
   * the buffered reader to read from r.
   */ reset(r) {
        this._reset(this.buf, r);
    }
    _reset(buf, rd) {
        this.buf = buf;
        this.rd = rd;
        this.eof = false;
    // this.lastByte = -1;
    // this.lastCharSize = -1;
    }
    /** reads data into p.
   * It returns the number of bytes read into p.
   * The bytes are taken from at most one Read on the underlying Reader,
   * hence n may be less than len(p).
   * To read exactly len(p) bytes, use io.ReadFull(b, p).
   */ async read(p) {
        let rr = p.byteLength;
        if (p.byteLength === 0) return rr;
        if (this.r === this.w) {
            if (p.byteLength >= this.buf.byteLength) {
                // Large read, empty buffer.
                // Read directly into p to avoid copy.
                const rr = await this.rd.read(p);
                const nread = rr ?? 0;
                assert(nread >= 0, "negative read");
                // if (rr.nread > 0) {
                //   this.lastByte = p[rr.nread - 1];
                //   this.lastCharSize = -1;
                // }
                return rr;
            }
            // One read.
            // Do not use this.fill, which will loop.
            this.r = 0;
            this.w = 0;
            rr = await this.rd.read(this.buf);
            if (rr === 0 || rr === null) return rr;
            assert(rr >= 0, "negative read");
            this.w += rr;
        }
        // copy as much as we can
        const copied = copy(this.buf.subarray(this.r, this.w), p, 0);
        this.r += copied;
        // this.lastByte = this.buf[this.r - 1];
        // this.lastCharSize = -1;
        return copied;
    }
    /** reads exactly `p.length` bytes into `p`.
   *
   * If successful, `p` is returned.
   *
   * If the end of the underlying stream has been reached, and there are no more
   * bytes available in the buffer, `readFull()` returns `null` instead.
   *
   * An error is thrown if some bytes could be read, but not enough to fill `p`
   * entirely before the underlying stream reported an error or EOF. Any error
   * thrown will have a `partial` property that indicates the slice of the
   * buffer that has been successfully filled with data.
   *
   * Ported from https://golang.org/pkg/io/#ReadFull
   */ async readFull(p) {
        let bytesRead = 0;
        while(bytesRead < p.length){
            try {
                const rr = await this.read(p.subarray(bytesRead));
                if (rr === null) {
                    if (bytesRead === 0) {
                        return null;
                    } else {
                        throw new PartialReadError();
                    }
                }
                bytesRead += rr;
            } catch (err) {
                err.partial = p.subarray(0, bytesRead);
                throw err;
            }
        }
        return p;
    }
    /** Returns the next byte [0, 255] or `null`. */ async readByte() {
        while(this.r === this.w){
            if (this.eof) return null;
            await this._fill(); // buffer is empty.
        }
        const c = this.buf[this.r];
        this.r++;
        // this.lastByte = c;
        return c;
    }
    /** readString() reads until the first occurrence of delim in the input,
   * returning a string containing the data up to and including the delimiter.
   * If ReadString encounters an error before finding a delimiter,
   * it returns the data read before the error and the error itself
   * (often `null`).
   * ReadString returns err != nil if and only if the returned data does not end
   * in delim.
   * For simple uses, a Scanner may be more convenient.
   */ async readString(delim) {
        if (delim.length !== 1) {
            throw new Error("Delimiter should be a single character");
        }
        const buffer = await this.readSlice(delim.charCodeAt(0));
        if (buffer === null) return null;
        return new TextDecoder().decode(buffer);
    }
    /** `readLine()` is a low-level line-reading primitive. Most callers should
   * use `readString('\n')` instead or use a Scanner.
   *
   * `readLine()` tries to return a single line, not including the end-of-line
   * bytes. If the line was too long for the buffer then `more` is set and the
   * beginning of the line is returned. The rest of the line will be returned
   * from future calls. `more` will be false when returning the last fragment
   * of the line. The returned buffer is only valid until the next call to
   * `readLine()`.
   *
   * The text returned from ReadLine does not include the line end ("\r\n" or
   * "\n").
   *
   * When the end of the underlying stream is reached, the final bytes in the
   * stream are returned. No indication or error is given if the input ends
   * without a final line end. When there are no more trailing bytes to read,
   * `readLine()` returns `null`.
   *
   * Calling `unreadByte()` after `readLine()` will always unread the last byte
   * read (possibly a character belonging to the line end) even if that byte is
   * not part of the line returned by `readLine()`.
   */ async readLine() {
        let line;
        try {
            line = await this.readSlice(LF);
        } catch (err) {
            let { partial  } = err;
            assert(partial instanceof Uint8Array, "bufio: caught error from `readSlice()` without `partial` property");
            // Don't throw if `readSlice()` failed with `BufferFullError`, instead we
            // just return whatever is available and set the `more` flag.
            if (!(err instanceof BufferFullError)) {
                throw err;
            }
            // Handle the case where "\r\n" straddles the buffer.
            if (!this.eof && partial.byteLength > 0 && partial[partial.byteLength - 1] === CR) {
                // Put the '\r' back on buf and drop it from line.
                // Let the next call to ReadLine check for "\r\n".
                assert(this.r > 0, "bufio: tried to rewind past start of buffer");
                this.r--;
                partial = partial.subarray(0, partial.byteLength - 1);
            }
            return {
                line: partial,
                more: !this.eof
            };
        }
        if (line === null) {
            return null;
        }
        if (line.byteLength === 0) {
            return {
                line,
                more: false
            };
        }
        if (line[line.byteLength - 1] == LF) {
            let drop = 1;
            if (line.byteLength > 1 && line[line.byteLength - 2] === CR) {
                drop = 2;
            }
            line = line.subarray(0, line.byteLength - drop);
        }
        return {
            line,
            more: false
        };
    }
    /** `readSlice()` reads until the first occurrence of `delim` in the input,
   * returning a slice pointing at the bytes in the buffer. The bytes stop
   * being valid at the next read.
   *
   * If `readSlice()` encounters an error before finding a delimiter, or the
   * buffer fills without finding a delimiter, it throws an error with a
   * `partial` property that contains the entire buffer.
   *
   * If `readSlice()` encounters the end of the underlying stream and there are
   * any bytes left in the buffer, the rest of the buffer is returned. In other
   * words, EOF is always treated as a delimiter. Once the buffer is empty,
   * it returns `null`.
   *
   * Because the data returned from `readSlice()` will be overwritten by the
   * next I/O operation, most clients should use `readString()` instead.
   */ async readSlice(delim) {
        let s = 0; // search start index
        let slice;
        while(true){
            // Search buffer.
            let i = this.buf.subarray(this.r + s, this.w).indexOf(delim);
            if (i >= 0) {
                i += s;
                slice = this.buf.subarray(this.r, this.r + i + 1);
                this.r += i + 1;
                break;
            }
            // EOF?
            if (this.eof) {
                if (this.r === this.w) {
                    return null;
                }
                slice = this.buf.subarray(this.r, this.w);
                this.r = this.w;
                break;
            }
            // Buffer full?
            if (this.buffered() >= this.buf.byteLength) {
                this.r = this.w;
                // #4521 The internal buffer should not be reused across reads because it causes corruption of data.
                const oldbuf = this.buf;
                const newbuf = this.buf.slice(0);
                this.buf = newbuf;
                throw new BufferFullError(oldbuf);
            }
            s = this.w - this.r; // do not rescan area we scanned before
            // Buffer is not full.
            try {
                await this._fill();
            } catch (err) {
                err.partial = slice;
                throw err;
            }
        }
        // Handle last byte, if any.
        // const i = slice.byteLength - 1;
        // if (i >= 0) {
        //   this.lastByte = slice[i];
        //   this.lastCharSize = -1
        // }
        return slice;
    }
    /** `peek()` returns the next `n` bytes without advancing the reader. The
   * bytes stop being valid at the next read call.
   *
   * When the end of the underlying stream is reached, but there are unread
   * bytes left in the buffer, those bytes are returned. If there are no bytes
   * left in the buffer, it returns `null`.
   *
   * If an error is encountered before `n` bytes are available, `peek()` throws
   * an error with the `partial` property set to a slice of the buffer that
   * contains the bytes that were available before the error occurred.
   */ async peek(n) {
        if (n < 0) {
            throw Error("negative count");
        }
        let avail = this.w - this.r;
        while(avail < n && avail < this.buf.byteLength && !this.eof){
            try {
                await this._fill();
            } catch (err) {
                err.partial = this.buf.subarray(this.r, this.w);
                throw err;
            }
            avail = this.w - this.r;
        }
        if (avail === 0 && this.eof) {
            return null;
        } else if (avail < n && this.eof) {
            return this.buf.subarray(this.r, this.r + avail);
        } else if (avail < n) {
            throw new BufferFullError(this.buf.subarray(this.r, this.w));
        }
        return this.buf.subarray(this.r, this.r + n);
    }
}
class AbstractBufBase {
    buf;
    usedBufferBytes = 0;
    err = null;
    /** Size returns the size of the underlying buffer in bytes. */ size() {
        return this.buf.byteLength;
    }
    /** Returns how many bytes are unused in the buffer. */ available() {
        return this.buf.byteLength - this.usedBufferBytes;
    }
    /** buffered returns the number of bytes that have been written into the
   * current buffer.
   */ buffered() {
        return this.usedBufferBytes;
    }
}
/** BufWriter implements buffering for an deno.Writer object.
 * If an error occurs writing to a Writer, no more data will be
 * accepted and all subsequent writes, and flush(), will return the error.
 * After all data has been written, the client should call the
 * flush() method to guarantee all data has been forwarded to
 * the underlying deno.Writer.
 */ export class BufWriter extends AbstractBufBase {
    writer;
    /** return new BufWriter unless writer is BufWriter */ static create(writer, size = DEFAULT_BUF_SIZE) {
        return writer instanceof BufWriter ? writer : new BufWriter(writer, size);
    }
    constructor(writer, size = DEFAULT_BUF_SIZE){
        super();
        this.writer = writer;
        if (size <= 0) {
            size = DEFAULT_BUF_SIZE;
        }
        this.buf = new Uint8Array(size);
    }
    /** Discards any unflushed buffered data, clears any error, and
   * resets buffer to write its output to w.
   */ reset(w) {
        this.err = null;
        this.usedBufferBytes = 0;
        this.writer = w;
    }
    /** Flush writes any buffered data to the underlying io.Writer. */ async flush() {
        if (this.err !== null) throw this.err;
        if (this.usedBufferBytes === 0) return;
        try {
            await writeAll(this.writer, this.buf.subarray(0, this.usedBufferBytes));
        } catch (e) {
            this.err = e;
            throw e;
        }
        this.buf = new Uint8Array(this.buf.length);
        this.usedBufferBytes = 0;
    }
    /** Writes the contents of `data` into the buffer.  If the contents won't fully
   * fit into the buffer, those bytes that can are copied into the buffer, the
   * buffer is the flushed to the writer and the remaining bytes are copied into
   * the now empty buffer.
   *
   * @return the number of bytes written to the buffer.
   */ async write(data) {
        if (this.err !== null) throw this.err;
        if (data.length === 0) return 0;
        let totalBytesWritten = 0;
        let numBytesWritten = 0;
        while(data.byteLength > this.available()){
            if (this.buffered() === 0) {
                // Large write, empty buffer.
                // Write directly from data to avoid copy.
                try {
                    numBytesWritten = await this.writer.write(data);
                } catch (e) {
                    this.err = e;
                    throw e;
                }
            } else {
                numBytesWritten = copy(data, this.buf, this.usedBufferBytes);
                this.usedBufferBytes += numBytesWritten;
                await this.flush();
            }
            totalBytesWritten += numBytesWritten;
            data = data.subarray(numBytesWritten);
        }
        numBytesWritten = copy(data, this.buf, this.usedBufferBytes);
        this.usedBufferBytes += numBytesWritten;
        totalBytesWritten += numBytesWritten;
        return totalBytesWritten;
    }
}
/** BufWriterSync implements buffering for a deno.WriterSync object.
 * If an error occurs writing to a WriterSync, no more data will be
 * accepted and all subsequent writes, and flush(), will return the error.
 * After all data has been written, the client should call the
 * flush() method to guarantee all data has been forwarded to
 * the underlying deno.WriterSync.
 */ export class BufWriterSync extends AbstractBufBase {
    writer;
    /** return new BufWriterSync unless writer is BufWriterSync */ static create(writer, size = DEFAULT_BUF_SIZE) {
        return writer instanceof BufWriterSync ? writer : new BufWriterSync(writer, size);
    }
    constructor(writer, size = DEFAULT_BUF_SIZE){
        super();
        this.writer = writer;
        if (size <= 0) {
            size = DEFAULT_BUF_SIZE;
        }
        this.buf = new Uint8Array(size);
    }
    /** Discards any unflushed buffered data, clears any error, and
   * resets buffer to write its output to w.
   */ reset(w) {
        this.err = null;
        this.usedBufferBytes = 0;
        this.writer = w;
    }
    /** Flush writes any buffered data to the underlying io.WriterSync. */ flush() {
        if (this.err !== null) throw this.err;
        if (this.usedBufferBytes === 0) return;
        try {
            writeAllSync(this.writer, this.buf.subarray(0, this.usedBufferBytes));
        } catch (e) {
            this.err = e;
            throw e;
        }
        this.buf = new Uint8Array(this.buf.length);
        this.usedBufferBytes = 0;
    }
    /** Writes the contents of `data` into the buffer.  If the contents won't fully
   * fit into the buffer, those bytes that can are copied into the buffer, the
   * buffer is the flushed to the writer and the remaining bytes are copied into
   * the now empty buffer.
   *
   * @return the number of bytes written to the buffer.
   */ writeSync(data) {
        if (this.err !== null) throw this.err;
        if (data.length === 0) return 0;
        let totalBytesWritten = 0;
        let numBytesWritten = 0;
        while(data.byteLength > this.available()){
            if (this.buffered() === 0) {
                // Large write, empty buffer.
                // Write directly from data to avoid copy.
                try {
                    numBytesWritten = this.writer.writeSync(data);
                } catch (e) {
                    this.err = e;
                    throw e;
                }
            } else {
                numBytesWritten = copy(data, this.buf, this.usedBufferBytes);
                this.usedBufferBytes += numBytesWritten;
                this.flush();
            }
            totalBytesWritten += numBytesWritten;
            data = data.subarray(numBytesWritten);
        }
        numBytesWritten = copy(data, this.buf, this.usedBufferBytes);
        this.usedBufferBytes += numBytesWritten;
        totalBytesWritten += numBytesWritten;
        return totalBytesWritten;
    }
}
/** Generate longest proper prefix which is also suffix array. */ function createLPS(pat) {
    const lps = new Uint8Array(pat.length);
    lps[0] = 0;
    let prefixEnd = 0;
    let i = 1;
    while(i < lps.length){
        if (pat[i] == pat[prefixEnd]) {
            prefixEnd++;
            lps[i] = prefixEnd;
            i++;
        } else if (prefixEnd === 0) {
            lps[i] = 0;
            i++;
        } else {
            prefixEnd = lps[prefixEnd - 1];
        }
    }
    return lps;
}
/** Read delimited bytes from a Reader. */ export async function* readDelim(reader, delim) {
    // Avoid unicode problems
    const delimLen = delim.length;
    const delimLPS = createLPS(delim);
    const chunks = new BytesList();
    const bufSize = Math.max(1024, delimLen + 1);
    // Modified KMP
    let inspectIndex = 0;
    let matchIndex = 0;
    while(true){
        const inspectArr = new Uint8Array(bufSize);
        const result = await reader.read(inspectArr);
        if (result === null) {
            // Yield last chunk.
            yield chunks.concat();
            return;
        } else if (result < 0) {
            // Discard all remaining and silently fail.
            return;
        }
        chunks.add(inspectArr, 0, result);
        let localIndex = 0;
        while(inspectIndex < chunks.size()){
            if (inspectArr[localIndex] === delim[matchIndex]) {
                inspectIndex++;
                localIndex++;
                matchIndex++;
                if (matchIndex === delimLen) {
                    // Full match
                    const matchEnd = inspectIndex - delimLen;
                    const readyBytes = chunks.slice(0, matchEnd);
                    yield readyBytes;
                    // Reset match, different from KMP.
                    chunks.shift(inspectIndex);
                    inspectIndex = 0;
                    matchIndex = 0;
                }
            } else {
                if (matchIndex === 0) {
                    inspectIndex++;
                    localIndex++;
                } else {
                    matchIndex = delimLPS[matchIndex - 1];
                }
            }
        }
    }
}
/** Read delimited strings from a Reader. */ export async function* readStringDelim(reader, delim, decoderOpts) {
    const encoder = new TextEncoder();
    const decoder = new TextDecoder(decoderOpts?.encoding, decoderOpts);
    for await (const chunk of readDelim(reader, encoder.encode(delim))){
        yield decoder.decode(chunk);
    }
}
/** Read strings line-by-line from a Reader. */ export async function* readLines(reader, decoderOpts) {
    for await (let chunk of readStringDelim(reader, "\n", decoderOpts)){
        // Finding a CR at the end of the line is evidence of a
        // "\r\n" at the end of the line. The "\r" part should be
        // removed too.
        if (chunk.endsWith("\r")) {
            chunk = chunk.slice(0, -1);
        }
        yield chunk;
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbImh0dHBzOi8vZGVuby5sYW5kL3N0ZEAwLjk5LjAvaW8vYnVmaW8udHMiXSwic291cmNlc0NvbnRlbnQiOlsiLy8gQ29weXJpZ2h0IDIwMTgtMjAyMSB0aGUgRGVubyBhdXRob3JzLiBBbGwgcmlnaHRzIHJlc2VydmVkLiBNSVQgbGljZW5zZS5cbi8vIEJhc2VkIG9uIGh0dHBzOi8vZ2l0aHViLmNvbS9nb2xhbmcvZ28vYmxvYi84OTE2ODIvc3JjL2J1ZmlvL2J1ZmlvLmdvXG4vLyBDb3B5cmlnaHQgMjAwOSBUaGUgR28gQXV0aG9ycy4gQWxsIHJpZ2h0cyByZXNlcnZlZC5cbi8vIFVzZSBvZiB0aGlzIHNvdXJjZSBjb2RlIGlzIGdvdmVybmVkIGJ5IGEgQlNELXN0eWxlXG4vLyBsaWNlbnNlIHRoYXQgY2FuIGJlIGZvdW5kIGluIHRoZSBMSUNFTlNFIGZpbGUuXG5cbnR5cGUgUmVhZGVyID0gRGVuby5SZWFkZXI7XG50eXBlIFdyaXRlciA9IERlbm8uV3JpdGVyO1xudHlwZSBXcml0ZXJTeW5jID0gRGVuby5Xcml0ZXJTeW5jO1xuaW1wb3J0IHsgY29weSB9IGZyb20gXCIuLi9ieXRlcy9tb2QudHNcIjtcbmltcG9ydCB7IGFzc2VydCB9IGZyb20gXCIuLi9fdXRpbC9hc3NlcnQudHNcIjtcbmltcG9ydCB7IEJ5dGVzTGlzdCB9IGZyb20gXCIuLi9ieXRlcy9ieXRlc19saXN0LnRzXCI7XG5pbXBvcnQgeyB3cml0ZUFsbCwgd3JpdGVBbGxTeW5jIH0gZnJvbSBcIi4vdXRpbC50c1wiO1xuXG5jb25zdCBERUZBVUxUX0JVRl9TSVpFID0gNDA5NjtcbmNvbnN0IE1JTl9CVUZfU0laRSA9IDE2O1xuY29uc3QgTUFYX0NPTlNFQ1VUSVZFX0VNUFRZX1JFQURTID0gMTAwO1xuY29uc3QgQ1IgPSBcIlxcclwiLmNoYXJDb2RlQXQoMCk7XG5jb25zdCBMRiA9IFwiXFxuXCIuY2hhckNvZGVBdCgwKTtcblxuZXhwb3J0IGNsYXNzIEJ1ZmZlckZ1bGxFcnJvciBleHRlbmRzIEVycm9yIHtcbiAgbmFtZSA9IFwiQnVmZmVyRnVsbEVycm9yXCI7XG4gIGNvbnN0cnVjdG9yKHB1YmxpYyBwYXJ0aWFsOiBVaW50OEFycmF5KSB7XG4gICAgc3VwZXIoXCJCdWZmZXIgZnVsbFwiKTtcbiAgfVxufVxuXG5leHBvcnQgY2xhc3MgUGFydGlhbFJlYWRFcnJvciBleHRlbmRzIEVycm9yIHtcbiAgbmFtZSA9IFwiUGFydGlhbFJlYWRFcnJvclwiO1xuICBwYXJ0aWFsPzogVWludDhBcnJheTtcbiAgY29uc3RydWN0b3IoKSB7XG4gICAgc3VwZXIoXCJFbmNvdW50ZXJlZCBVbmV4cGVjdGVkRW9mLCBkYXRhIG9ubHkgcGFydGlhbGx5IHJlYWRcIik7XG4gIH1cbn1cblxuLyoqIFJlc3VsdCB0eXBlIHJldHVybmVkIGJ5IG9mIEJ1ZlJlYWRlci5yZWFkTGluZSgpLiAqL1xuZXhwb3J0IGludGVyZmFjZSBSZWFkTGluZVJlc3VsdCB7XG4gIGxpbmU6IFVpbnQ4QXJyYXk7XG4gIG1vcmU6IGJvb2xlYW47XG59XG5cbi8qKiBCdWZSZWFkZXIgaW1wbGVtZW50cyBidWZmZXJpbmcgZm9yIGEgUmVhZGVyIG9iamVjdC4gKi9cbmV4cG9ydCBjbGFzcyBCdWZSZWFkZXIgaW1wbGVtZW50cyBSZWFkZXIge1xuICBwcml2YXRlIGJ1ZiE6IFVpbnQ4QXJyYXk7XG4gIHByaXZhdGUgcmQhOiBSZWFkZXI7IC8vIFJlYWRlciBwcm92aWRlZCBieSBjYWxsZXIuXG4gIHByaXZhdGUgciA9IDA7IC8vIGJ1ZiByZWFkIHBvc2l0aW9uLlxuICBwcml2YXRlIHcgPSAwOyAvLyBidWYgd3JpdGUgcG9zaXRpb24uXG4gIHByaXZhdGUgZW9mID0gZmFsc2U7XG4gIC8vIHByaXZhdGUgbGFzdEJ5dGU6IG51bWJlcjtcbiAgLy8gcHJpdmF0ZSBsYXN0Q2hhclNpemU6IG51bWJlcjtcblxuICAvKiogcmV0dXJuIG5ldyBCdWZSZWFkZXIgdW5sZXNzIHIgaXMgQnVmUmVhZGVyICovXG4gIHN0YXRpYyBjcmVhdGUocjogUmVhZGVyLCBzaXplOiBudW1iZXIgPSBERUZBVUxUX0JVRl9TSVpFKTogQnVmUmVhZGVyIHtcbiAgICByZXR1cm4gciBpbnN0YW5jZW9mIEJ1ZlJlYWRlciA/IHIgOiBuZXcgQnVmUmVhZGVyKHIsIHNpemUpO1xuICB9XG5cbiAgY29uc3RydWN0b3IocmQ6IFJlYWRlciwgc2l6ZTogbnVtYmVyID0gREVGQVVMVF9CVUZfU0laRSkge1xuICAgIGlmIChzaXplIDwgTUlOX0JVRl9TSVpFKSB7XG4gICAgICBzaXplID0gTUlOX0JVRl9TSVpFO1xuICAgIH1cbiAgICB0aGlzLl9yZXNldChuZXcgVWludDhBcnJheShzaXplKSwgcmQpO1xuICB9XG5cbiAgLyoqIFJldHVybnMgdGhlIHNpemUgb2YgdGhlIHVuZGVybHlpbmcgYnVmZmVyIGluIGJ5dGVzLiAqL1xuICBzaXplKCk6IG51bWJlciB7XG4gICAgcmV0dXJuIHRoaXMuYnVmLmJ5dGVMZW5ndGg7XG4gIH1cblxuICBidWZmZXJlZCgpOiBudW1iZXIge1xuICAgIHJldHVybiB0aGlzLncgLSB0aGlzLnI7XG4gIH1cblxuICAvLyBSZWFkcyBhIG5ldyBjaHVuayBpbnRvIHRoZSBidWZmZXIuXG4gIHByaXZhdGUgYXN5bmMgX2ZpbGwoKSB7XG4gICAgLy8gU2xpZGUgZXhpc3RpbmcgZGF0YSB0byBiZWdpbm5pbmcuXG4gICAgaWYgKHRoaXMuciA+IDApIHtcbiAgICAgIHRoaXMuYnVmLmNvcHlXaXRoaW4oMCwgdGhpcy5yLCB0aGlzLncpO1xuICAgICAgdGhpcy53IC09IHRoaXMucjtcbiAgICAgIHRoaXMuciA9IDA7XG4gICAgfVxuXG4gICAgaWYgKHRoaXMudyA+PSB0aGlzLmJ1Zi5ieXRlTGVuZ3RoKSB7XG4gICAgICB0aHJvdyBFcnJvcihcImJ1ZmlvOiB0cmllZCB0byBmaWxsIGZ1bGwgYnVmZmVyXCIpO1xuICAgIH1cblxuICAgIC8vIFJlYWQgbmV3IGRhdGE6IHRyeSBhIGxpbWl0ZWQgbnVtYmVyIG9mIHRpbWVzLlxuICAgIGZvciAobGV0IGkgPSBNQVhfQ09OU0VDVVRJVkVfRU1QVFlfUkVBRFM7IGkgPiAwOyBpLS0pIHtcbiAgICAgIGNvbnN0IHJyID0gYXdhaXQgdGhpcy5yZC5yZWFkKHRoaXMuYnVmLnN1YmFycmF5KHRoaXMudykpO1xuICAgICAgaWYgKHJyID09PSBudWxsKSB7XG4gICAgICAgIHRoaXMuZW9mID0gdHJ1ZTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgYXNzZXJ0KHJyID49IDAsIFwibmVnYXRpdmUgcmVhZFwiKTtcbiAgICAgIHRoaXMudyArPSBycjtcbiAgICAgIGlmIChyciA+IDApIHtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgIH1cblxuICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgIGBObyBwcm9ncmVzcyBhZnRlciAke01BWF9DT05TRUNVVElWRV9FTVBUWV9SRUFEU30gcmVhZCgpIGNhbGxzYCxcbiAgICApO1xuICB9XG5cbiAgLyoqIERpc2NhcmRzIGFueSBidWZmZXJlZCBkYXRhLCByZXNldHMgYWxsIHN0YXRlLCBhbmQgc3dpdGNoZXNcbiAgICogdGhlIGJ1ZmZlcmVkIHJlYWRlciB0byByZWFkIGZyb20gci5cbiAgICovXG4gIHJlc2V0KHI6IFJlYWRlcik6IHZvaWQge1xuICAgIHRoaXMuX3Jlc2V0KHRoaXMuYnVmLCByKTtcbiAgfVxuXG4gIHByaXZhdGUgX3Jlc2V0KGJ1ZjogVWludDhBcnJheSwgcmQ6IFJlYWRlcik6IHZvaWQge1xuICAgIHRoaXMuYnVmID0gYnVmO1xuICAgIHRoaXMucmQgPSByZDtcbiAgICB0aGlzLmVvZiA9IGZhbHNlO1xuICAgIC8vIHRoaXMubGFzdEJ5dGUgPSAtMTtcbiAgICAvLyB0aGlzLmxhc3RDaGFyU2l6ZSA9IC0xO1xuICB9XG5cbiAgLyoqIHJlYWRzIGRhdGEgaW50byBwLlxuICAgKiBJdCByZXR1cm5zIHRoZSBudW1iZXIgb2YgYnl0ZXMgcmVhZCBpbnRvIHAuXG4gICAqIFRoZSBieXRlcyBhcmUgdGFrZW4gZnJvbSBhdCBtb3N0IG9uZSBSZWFkIG9uIHRoZSB1bmRlcmx5aW5nIFJlYWRlcixcbiAgICogaGVuY2UgbiBtYXkgYmUgbGVzcyB0aGFuIGxlbihwKS5cbiAgICogVG8gcmVhZCBleGFjdGx5IGxlbihwKSBieXRlcywgdXNlIGlvLlJlYWRGdWxsKGIsIHApLlxuICAgKi9cbiAgYXN5bmMgcmVhZChwOiBVaW50OEFycmF5KTogUHJvbWlzZTxudW1iZXIgfCBudWxsPiB7XG4gICAgbGV0IHJyOiBudW1iZXIgfCBudWxsID0gcC5ieXRlTGVuZ3RoO1xuICAgIGlmIChwLmJ5dGVMZW5ndGggPT09IDApIHJldHVybiBycjtcblxuICAgIGlmICh0aGlzLnIgPT09IHRoaXMudykge1xuICAgICAgaWYgKHAuYnl0ZUxlbmd0aCA+PSB0aGlzLmJ1Zi5ieXRlTGVuZ3RoKSB7XG4gICAgICAgIC8vIExhcmdlIHJlYWQsIGVtcHR5IGJ1ZmZlci5cbiAgICAgICAgLy8gUmVhZCBkaXJlY3RseSBpbnRvIHAgdG8gYXZvaWQgY29weS5cbiAgICAgICAgY29uc3QgcnIgPSBhd2FpdCB0aGlzLnJkLnJlYWQocCk7XG4gICAgICAgIGNvbnN0IG5yZWFkID0gcnIgPz8gMDtcbiAgICAgICAgYXNzZXJ0KG5yZWFkID49IDAsIFwibmVnYXRpdmUgcmVhZFwiKTtcbiAgICAgICAgLy8gaWYgKHJyLm5yZWFkID4gMCkge1xuICAgICAgICAvLyAgIHRoaXMubGFzdEJ5dGUgPSBwW3JyLm5yZWFkIC0gMV07XG4gICAgICAgIC8vICAgdGhpcy5sYXN0Q2hhclNpemUgPSAtMTtcbiAgICAgICAgLy8gfVxuICAgICAgICByZXR1cm4gcnI7XG4gICAgICB9XG5cbiAgICAgIC8vIE9uZSByZWFkLlxuICAgICAgLy8gRG8gbm90IHVzZSB0aGlzLmZpbGwsIHdoaWNoIHdpbGwgbG9vcC5cbiAgICAgIHRoaXMuciA9IDA7XG4gICAgICB0aGlzLncgPSAwO1xuICAgICAgcnIgPSBhd2FpdCB0aGlzLnJkLnJlYWQodGhpcy5idWYpO1xuICAgICAgaWYgKHJyID09PSAwIHx8IHJyID09PSBudWxsKSByZXR1cm4gcnI7XG4gICAgICBhc3NlcnQocnIgPj0gMCwgXCJuZWdhdGl2ZSByZWFkXCIpO1xuICAgICAgdGhpcy53ICs9IHJyO1xuICAgIH1cblxuICAgIC8vIGNvcHkgYXMgbXVjaCBhcyB3ZSBjYW5cbiAgICBjb25zdCBjb3BpZWQgPSBjb3B5KHRoaXMuYnVmLnN1YmFycmF5KHRoaXMuciwgdGhpcy53KSwgcCwgMCk7XG4gICAgdGhpcy5yICs9IGNvcGllZDtcbiAgICAvLyB0aGlzLmxhc3RCeXRlID0gdGhpcy5idWZbdGhpcy5yIC0gMV07XG4gICAgLy8gdGhpcy5sYXN0Q2hhclNpemUgPSAtMTtcbiAgICByZXR1cm4gY29waWVkO1xuICB9XG5cbiAgLyoqIHJlYWRzIGV4YWN0bHkgYHAubGVuZ3RoYCBieXRlcyBpbnRvIGBwYC5cbiAgICpcbiAgICogSWYgc3VjY2Vzc2Z1bCwgYHBgIGlzIHJldHVybmVkLlxuICAgKlxuICAgKiBJZiB0aGUgZW5kIG9mIHRoZSB1bmRlcmx5aW5nIHN0cmVhbSBoYXMgYmVlbiByZWFjaGVkLCBhbmQgdGhlcmUgYXJlIG5vIG1vcmVcbiAgICogYnl0ZXMgYXZhaWxhYmxlIGluIHRoZSBidWZmZXIsIGByZWFkRnVsbCgpYCByZXR1cm5zIGBudWxsYCBpbnN0ZWFkLlxuICAgKlxuICAgKiBBbiBlcnJvciBpcyB0aHJvd24gaWYgc29tZSBieXRlcyBjb3VsZCBiZSByZWFkLCBidXQgbm90IGVub3VnaCB0byBmaWxsIGBwYFxuICAgKiBlbnRpcmVseSBiZWZvcmUgdGhlIHVuZGVybHlpbmcgc3RyZWFtIHJlcG9ydGVkIGFuIGVycm9yIG9yIEVPRi4gQW55IGVycm9yXG4gICAqIHRocm93biB3aWxsIGhhdmUgYSBgcGFydGlhbGAgcHJvcGVydHkgdGhhdCBpbmRpY2F0ZXMgdGhlIHNsaWNlIG9mIHRoZVxuICAgKiBidWZmZXIgdGhhdCBoYXMgYmVlbiBzdWNjZXNzZnVsbHkgZmlsbGVkIHdpdGggZGF0YS5cbiAgICpcbiAgICogUG9ydGVkIGZyb20gaHR0cHM6Ly9nb2xhbmcub3JnL3BrZy9pby8jUmVhZEZ1bGxcbiAgICovXG4gIGFzeW5jIHJlYWRGdWxsKHA6IFVpbnQ4QXJyYXkpOiBQcm9taXNlPFVpbnQ4QXJyYXkgfCBudWxsPiB7XG4gICAgbGV0IGJ5dGVzUmVhZCA9IDA7XG4gICAgd2hpbGUgKGJ5dGVzUmVhZCA8IHAubGVuZ3RoKSB7XG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCByciA9IGF3YWl0IHRoaXMucmVhZChwLnN1YmFycmF5KGJ5dGVzUmVhZCkpO1xuICAgICAgICBpZiAocnIgPT09IG51bGwpIHtcbiAgICAgICAgICBpZiAoYnl0ZXNSZWFkID09PSAwKSB7XG4gICAgICAgICAgICByZXR1cm4gbnVsbDtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgdGhyb3cgbmV3IFBhcnRpYWxSZWFkRXJyb3IoKTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgYnl0ZXNSZWFkICs9IHJyO1xuICAgICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICAgIGVyci5wYXJ0aWFsID0gcC5zdWJhcnJheSgwLCBieXRlc1JlYWQpO1xuICAgICAgICB0aHJvdyBlcnI7XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiBwO1xuICB9XG5cbiAgLyoqIFJldHVybnMgdGhlIG5leHQgYnl0ZSBbMCwgMjU1XSBvciBgbnVsbGAuICovXG4gIGFzeW5jIHJlYWRCeXRlKCk6IFByb21pc2U8bnVtYmVyIHwgbnVsbD4ge1xuICAgIHdoaWxlICh0aGlzLnIgPT09IHRoaXMudykge1xuICAgICAgaWYgKHRoaXMuZW9mKSByZXR1cm4gbnVsbDtcbiAgICAgIGF3YWl0IHRoaXMuX2ZpbGwoKTsgLy8gYnVmZmVyIGlzIGVtcHR5LlxuICAgIH1cbiAgICBjb25zdCBjID0gdGhpcy5idWZbdGhpcy5yXTtcbiAgICB0aGlzLnIrKztcbiAgICAvLyB0aGlzLmxhc3RCeXRlID0gYztcbiAgICByZXR1cm4gYztcbiAgfVxuXG4gIC8qKiByZWFkU3RyaW5nKCkgcmVhZHMgdW50aWwgdGhlIGZpcnN0IG9jY3VycmVuY2Ugb2YgZGVsaW0gaW4gdGhlIGlucHV0LFxuICAgKiByZXR1cm5pbmcgYSBzdHJpbmcgY29udGFpbmluZyB0aGUgZGF0YSB1cCB0byBhbmQgaW5jbHVkaW5nIHRoZSBkZWxpbWl0ZXIuXG4gICAqIElmIFJlYWRTdHJpbmcgZW5jb3VudGVycyBhbiBlcnJvciBiZWZvcmUgZmluZGluZyBhIGRlbGltaXRlcixcbiAgICogaXQgcmV0dXJucyB0aGUgZGF0YSByZWFkIGJlZm9yZSB0aGUgZXJyb3IgYW5kIHRoZSBlcnJvciBpdHNlbGZcbiAgICogKG9mdGVuIGBudWxsYCkuXG4gICAqIFJlYWRTdHJpbmcgcmV0dXJucyBlcnIgIT0gbmlsIGlmIGFuZCBvbmx5IGlmIHRoZSByZXR1cm5lZCBkYXRhIGRvZXMgbm90IGVuZFxuICAgKiBpbiBkZWxpbS5cbiAgICogRm9yIHNpbXBsZSB1c2VzLCBhIFNjYW5uZXIgbWF5IGJlIG1vcmUgY29udmVuaWVudC5cbiAgICovXG4gIGFzeW5jIHJlYWRTdHJpbmcoZGVsaW06IHN0cmluZyk6IFByb21pc2U8c3RyaW5nIHwgbnVsbD4ge1xuICAgIGlmIChkZWxpbS5sZW5ndGggIT09IDEpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkRlbGltaXRlciBzaG91bGQgYmUgYSBzaW5nbGUgY2hhcmFjdGVyXCIpO1xuICAgIH1cbiAgICBjb25zdCBidWZmZXIgPSBhd2FpdCB0aGlzLnJlYWRTbGljZShkZWxpbS5jaGFyQ29kZUF0KDApKTtcbiAgICBpZiAoYnVmZmVyID09PSBudWxsKSByZXR1cm4gbnVsbDtcbiAgICByZXR1cm4gbmV3IFRleHREZWNvZGVyKCkuZGVjb2RlKGJ1ZmZlcik7XG4gIH1cblxuICAvKiogYHJlYWRMaW5lKClgIGlzIGEgbG93LWxldmVsIGxpbmUtcmVhZGluZyBwcmltaXRpdmUuIE1vc3QgY2FsbGVycyBzaG91bGRcbiAgICogdXNlIGByZWFkU3RyaW5nKCdcXG4nKWAgaW5zdGVhZCBvciB1c2UgYSBTY2FubmVyLlxuICAgKlxuICAgKiBgcmVhZExpbmUoKWAgdHJpZXMgdG8gcmV0dXJuIGEgc2luZ2xlIGxpbmUsIG5vdCBpbmNsdWRpbmcgdGhlIGVuZC1vZi1saW5lXG4gICAqIGJ5dGVzLiBJZiB0aGUgbGluZSB3YXMgdG9vIGxvbmcgZm9yIHRoZSBidWZmZXIgdGhlbiBgbW9yZWAgaXMgc2V0IGFuZCB0aGVcbiAgICogYmVnaW5uaW5nIG9mIHRoZSBsaW5lIGlzIHJldHVybmVkLiBUaGUgcmVzdCBvZiB0aGUgbGluZSB3aWxsIGJlIHJldHVybmVkXG4gICAqIGZyb20gZnV0dXJlIGNhbGxzLiBgbW9yZWAgd2lsbCBiZSBmYWxzZSB3aGVuIHJldHVybmluZyB0aGUgbGFzdCBmcmFnbWVudFxuICAgKiBvZiB0aGUgbGluZS4gVGhlIHJldHVybmVkIGJ1ZmZlciBpcyBvbmx5IHZhbGlkIHVudGlsIHRoZSBuZXh0IGNhbGwgdG9cbiAgICogYHJlYWRMaW5lKClgLlxuICAgKlxuICAgKiBUaGUgdGV4dCByZXR1cm5lZCBmcm9tIFJlYWRMaW5lIGRvZXMgbm90IGluY2x1ZGUgdGhlIGxpbmUgZW5kIChcIlxcclxcblwiIG9yXG4gICAqIFwiXFxuXCIpLlxuICAgKlxuICAgKiBXaGVuIHRoZSBlbmQgb2YgdGhlIHVuZGVybHlpbmcgc3RyZWFtIGlzIHJlYWNoZWQsIHRoZSBmaW5hbCBieXRlcyBpbiB0aGVcbiAgICogc3RyZWFtIGFyZSByZXR1cm5lZC4gTm8gaW5kaWNhdGlvbiBvciBlcnJvciBpcyBnaXZlbiBpZiB0aGUgaW5wdXQgZW5kc1xuICAgKiB3aXRob3V0IGEgZmluYWwgbGluZSBlbmQuIFdoZW4gdGhlcmUgYXJlIG5vIG1vcmUgdHJhaWxpbmcgYnl0ZXMgdG8gcmVhZCxcbiAgICogYHJlYWRMaW5lKClgIHJldHVybnMgYG51bGxgLlxuICAgKlxuICAgKiBDYWxsaW5nIGB1bnJlYWRCeXRlKClgIGFmdGVyIGByZWFkTGluZSgpYCB3aWxsIGFsd2F5cyB1bnJlYWQgdGhlIGxhc3QgYnl0ZVxuICAgKiByZWFkIChwb3NzaWJseSBhIGNoYXJhY3RlciBiZWxvbmdpbmcgdG8gdGhlIGxpbmUgZW5kKSBldmVuIGlmIHRoYXQgYnl0ZSBpc1xuICAgKiBub3QgcGFydCBvZiB0aGUgbGluZSByZXR1cm5lZCBieSBgcmVhZExpbmUoKWAuXG4gICAqL1xuICBhc3luYyByZWFkTGluZSgpOiBQcm9taXNlPFJlYWRMaW5lUmVzdWx0IHwgbnVsbD4ge1xuICAgIGxldCBsaW5lOiBVaW50OEFycmF5IHwgbnVsbDtcblxuICAgIHRyeSB7XG4gICAgICBsaW5lID0gYXdhaXQgdGhpcy5yZWFkU2xpY2UoTEYpO1xuICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgbGV0IHsgcGFydGlhbCB9ID0gZXJyO1xuICAgICAgYXNzZXJ0KFxuICAgICAgICBwYXJ0aWFsIGluc3RhbmNlb2YgVWludDhBcnJheSxcbiAgICAgICAgXCJidWZpbzogY2F1Z2h0IGVycm9yIGZyb20gYHJlYWRTbGljZSgpYCB3aXRob3V0IGBwYXJ0aWFsYCBwcm9wZXJ0eVwiLFxuICAgICAgKTtcblxuICAgICAgLy8gRG9uJ3QgdGhyb3cgaWYgYHJlYWRTbGljZSgpYCBmYWlsZWQgd2l0aCBgQnVmZmVyRnVsbEVycm9yYCwgaW5zdGVhZCB3ZVxuICAgICAgLy8ganVzdCByZXR1cm4gd2hhdGV2ZXIgaXMgYXZhaWxhYmxlIGFuZCBzZXQgdGhlIGBtb3JlYCBmbGFnLlxuICAgICAgaWYgKCEoZXJyIGluc3RhbmNlb2YgQnVmZmVyRnVsbEVycm9yKSkge1xuICAgICAgICB0aHJvdyBlcnI7XG4gICAgICB9XG5cbiAgICAgIC8vIEhhbmRsZSB0aGUgY2FzZSB3aGVyZSBcIlxcclxcblwiIHN0cmFkZGxlcyB0aGUgYnVmZmVyLlxuICAgICAgaWYgKFxuICAgICAgICAhdGhpcy5lb2YgJiZcbiAgICAgICAgcGFydGlhbC5ieXRlTGVuZ3RoID4gMCAmJlxuICAgICAgICBwYXJ0aWFsW3BhcnRpYWwuYnl0ZUxlbmd0aCAtIDFdID09PSBDUlxuICAgICAgKSB7XG4gICAgICAgIC8vIFB1dCB0aGUgJ1xccicgYmFjayBvbiBidWYgYW5kIGRyb3AgaXQgZnJvbSBsaW5lLlxuICAgICAgICAvLyBMZXQgdGhlIG5leHQgY2FsbCB0byBSZWFkTGluZSBjaGVjayBmb3IgXCJcXHJcXG5cIi5cbiAgICAgICAgYXNzZXJ0KHRoaXMuciA+IDAsIFwiYnVmaW86IHRyaWVkIHRvIHJld2luZCBwYXN0IHN0YXJ0IG9mIGJ1ZmZlclwiKTtcbiAgICAgICAgdGhpcy5yLS07XG4gICAgICAgIHBhcnRpYWwgPSBwYXJ0aWFsLnN1YmFycmF5KDAsIHBhcnRpYWwuYnl0ZUxlbmd0aCAtIDEpO1xuICAgICAgfVxuXG4gICAgICByZXR1cm4geyBsaW5lOiBwYXJ0aWFsLCBtb3JlOiAhdGhpcy5lb2YgfTtcbiAgICB9XG5cbiAgICBpZiAobGluZSA9PT0gbnVsbCkge1xuICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuXG4gICAgaWYgKGxpbmUuYnl0ZUxlbmd0aCA9PT0gMCkge1xuICAgICAgcmV0dXJuIHsgbGluZSwgbW9yZTogZmFsc2UgfTtcbiAgICB9XG5cbiAgICBpZiAobGluZVtsaW5lLmJ5dGVMZW5ndGggLSAxXSA9PSBMRikge1xuICAgICAgbGV0IGRyb3AgPSAxO1xuICAgICAgaWYgKGxpbmUuYnl0ZUxlbmd0aCA+IDEgJiYgbGluZVtsaW5lLmJ5dGVMZW5ndGggLSAyXSA9PT0gQ1IpIHtcbiAgICAgICAgZHJvcCA9IDI7XG4gICAgICB9XG4gICAgICBsaW5lID0gbGluZS5zdWJhcnJheSgwLCBsaW5lLmJ5dGVMZW5ndGggLSBkcm9wKTtcbiAgICB9XG4gICAgcmV0dXJuIHsgbGluZSwgbW9yZTogZmFsc2UgfTtcbiAgfVxuXG4gIC8qKiBgcmVhZFNsaWNlKClgIHJlYWRzIHVudGlsIHRoZSBmaXJzdCBvY2N1cnJlbmNlIG9mIGBkZWxpbWAgaW4gdGhlIGlucHV0LFxuICAgKiByZXR1cm5pbmcgYSBzbGljZSBwb2ludGluZyBhdCB0aGUgYnl0ZXMgaW4gdGhlIGJ1ZmZlci4gVGhlIGJ5dGVzIHN0b3BcbiAgICogYmVpbmcgdmFsaWQgYXQgdGhlIG5leHQgcmVhZC5cbiAgICpcbiAgICogSWYgYHJlYWRTbGljZSgpYCBlbmNvdW50ZXJzIGFuIGVycm9yIGJlZm9yZSBmaW5kaW5nIGEgZGVsaW1pdGVyLCBvciB0aGVcbiAgICogYnVmZmVyIGZpbGxzIHdpdGhvdXQgZmluZGluZyBhIGRlbGltaXRlciwgaXQgdGhyb3dzIGFuIGVycm9yIHdpdGggYVxuICAgKiBgcGFydGlhbGAgcHJvcGVydHkgdGhhdCBjb250YWlucyB0aGUgZW50aXJlIGJ1ZmZlci5cbiAgICpcbiAgICogSWYgYHJlYWRTbGljZSgpYCBlbmNvdW50ZXJzIHRoZSBlbmQgb2YgdGhlIHVuZGVybHlpbmcgc3RyZWFtIGFuZCB0aGVyZSBhcmVcbiAgICogYW55IGJ5dGVzIGxlZnQgaW4gdGhlIGJ1ZmZlciwgdGhlIHJlc3Qgb2YgdGhlIGJ1ZmZlciBpcyByZXR1cm5lZC4gSW4gb3RoZXJcbiAgICogd29yZHMsIEVPRiBpcyBhbHdheXMgdHJlYXRlZCBhcyBhIGRlbGltaXRlci4gT25jZSB0aGUgYnVmZmVyIGlzIGVtcHR5LFxuICAgKiBpdCByZXR1cm5zIGBudWxsYC5cbiAgICpcbiAgICogQmVjYXVzZSB0aGUgZGF0YSByZXR1cm5lZCBmcm9tIGByZWFkU2xpY2UoKWAgd2lsbCBiZSBvdmVyd3JpdHRlbiBieSB0aGVcbiAgICogbmV4dCBJL08gb3BlcmF0aW9uLCBtb3N0IGNsaWVudHMgc2hvdWxkIHVzZSBgcmVhZFN0cmluZygpYCBpbnN0ZWFkLlxuICAgKi9cbiAgYXN5bmMgcmVhZFNsaWNlKGRlbGltOiBudW1iZXIpOiBQcm9taXNlPFVpbnQ4QXJyYXkgfCBudWxsPiB7XG4gICAgbGV0IHMgPSAwOyAvLyBzZWFyY2ggc3RhcnQgaW5kZXhcbiAgICBsZXQgc2xpY2U6IFVpbnQ4QXJyYXkgfCB1bmRlZmluZWQ7XG5cbiAgICB3aGlsZSAodHJ1ZSkge1xuICAgICAgLy8gU2VhcmNoIGJ1ZmZlci5cbiAgICAgIGxldCBpID0gdGhpcy5idWYuc3ViYXJyYXkodGhpcy5yICsgcywgdGhpcy53KS5pbmRleE9mKGRlbGltKTtcbiAgICAgIGlmIChpID49IDApIHtcbiAgICAgICAgaSArPSBzO1xuICAgICAgICBzbGljZSA9IHRoaXMuYnVmLnN1YmFycmF5KHRoaXMuciwgdGhpcy5yICsgaSArIDEpO1xuICAgICAgICB0aGlzLnIgKz0gaSArIDE7XG4gICAgICAgIGJyZWFrO1xuICAgICAgfVxuXG4gICAgICAvLyBFT0Y/XG4gICAgICBpZiAodGhpcy5lb2YpIHtcbiAgICAgICAgaWYgKHRoaXMuciA9PT0gdGhpcy53KSB7XG4gICAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgICAgIH1cbiAgICAgICAgc2xpY2UgPSB0aGlzLmJ1Zi5zdWJhcnJheSh0aGlzLnIsIHRoaXMudyk7XG4gICAgICAgIHRoaXMuciA9IHRoaXMudztcbiAgICAgICAgYnJlYWs7XG4gICAgICB9XG5cbiAgICAgIC8vIEJ1ZmZlciBmdWxsP1xuICAgICAgaWYgKHRoaXMuYnVmZmVyZWQoKSA+PSB0aGlzLmJ1Zi5ieXRlTGVuZ3RoKSB7XG4gICAgICAgIHRoaXMuciA9IHRoaXMudztcbiAgICAgICAgLy8gIzQ1MjEgVGhlIGludGVybmFsIGJ1ZmZlciBzaG91bGQgbm90IGJlIHJldXNlZCBhY3Jvc3MgcmVhZHMgYmVjYXVzZSBpdCBjYXVzZXMgY29ycnVwdGlvbiBvZiBkYXRhLlxuICAgICAgICBjb25zdCBvbGRidWYgPSB0aGlzLmJ1ZjtcbiAgICAgICAgY29uc3QgbmV3YnVmID0gdGhpcy5idWYuc2xpY2UoMCk7XG4gICAgICAgIHRoaXMuYnVmID0gbmV3YnVmO1xuICAgICAgICB0aHJvdyBuZXcgQnVmZmVyRnVsbEVycm9yKG9sZGJ1Zik7XG4gICAgICB9XG5cbiAgICAgIHMgPSB0aGlzLncgLSB0aGlzLnI7IC8vIGRvIG5vdCByZXNjYW4gYXJlYSB3ZSBzY2FubmVkIGJlZm9yZVxuXG4gICAgICAvLyBCdWZmZXIgaXMgbm90IGZ1bGwuXG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCB0aGlzLl9maWxsKCk7XG4gICAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgICAgZXJyLnBhcnRpYWwgPSBzbGljZTtcbiAgICAgICAgdGhyb3cgZXJyO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIEhhbmRsZSBsYXN0IGJ5dGUsIGlmIGFueS5cbiAgICAvLyBjb25zdCBpID0gc2xpY2UuYnl0ZUxlbmd0aCAtIDE7XG4gICAgLy8gaWYgKGkgPj0gMCkge1xuICAgIC8vICAgdGhpcy5sYXN0Qnl0ZSA9IHNsaWNlW2ldO1xuICAgIC8vICAgdGhpcy5sYXN0Q2hhclNpemUgPSAtMVxuICAgIC8vIH1cblxuICAgIHJldHVybiBzbGljZTtcbiAgfVxuXG4gIC8qKiBgcGVlaygpYCByZXR1cm5zIHRoZSBuZXh0IGBuYCBieXRlcyB3aXRob3V0IGFkdmFuY2luZyB0aGUgcmVhZGVyLiBUaGVcbiAgICogYnl0ZXMgc3RvcCBiZWluZyB2YWxpZCBhdCB0aGUgbmV4dCByZWFkIGNhbGwuXG4gICAqXG4gICAqIFdoZW4gdGhlIGVuZCBvZiB0aGUgdW5kZXJseWluZyBzdHJlYW0gaXMgcmVhY2hlZCwgYnV0IHRoZXJlIGFyZSB1bnJlYWRcbiAgICogYnl0ZXMgbGVmdCBpbiB0aGUgYnVmZmVyLCB0aG9zZSBieXRlcyBhcmUgcmV0dXJuZWQuIElmIHRoZXJlIGFyZSBubyBieXRlc1xuICAgKiBsZWZ0IGluIHRoZSBidWZmZXIsIGl0IHJldHVybnMgYG51bGxgLlxuICAgKlxuICAgKiBJZiBhbiBlcnJvciBpcyBlbmNvdW50ZXJlZCBiZWZvcmUgYG5gIGJ5dGVzIGFyZSBhdmFpbGFibGUsIGBwZWVrKClgIHRocm93c1xuICAgKiBhbiBlcnJvciB3aXRoIHRoZSBgcGFydGlhbGAgcHJvcGVydHkgc2V0IHRvIGEgc2xpY2Ugb2YgdGhlIGJ1ZmZlciB0aGF0XG4gICAqIGNvbnRhaW5zIHRoZSBieXRlcyB0aGF0IHdlcmUgYXZhaWxhYmxlIGJlZm9yZSB0aGUgZXJyb3Igb2NjdXJyZWQuXG4gICAqL1xuICBhc3luYyBwZWVrKG46IG51bWJlcik6IFByb21pc2U8VWludDhBcnJheSB8IG51bGw+IHtcbiAgICBpZiAobiA8IDApIHtcbiAgICAgIHRocm93IEVycm9yKFwibmVnYXRpdmUgY291bnRcIik7XG4gICAgfVxuXG4gICAgbGV0IGF2YWlsID0gdGhpcy53IC0gdGhpcy5yO1xuICAgIHdoaWxlIChhdmFpbCA8IG4gJiYgYXZhaWwgPCB0aGlzLmJ1Zi5ieXRlTGVuZ3RoICYmICF0aGlzLmVvZikge1xuICAgICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgdGhpcy5fZmlsbCgpO1xuICAgICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICAgIGVyci5wYXJ0aWFsID0gdGhpcy5idWYuc3ViYXJyYXkodGhpcy5yLCB0aGlzLncpO1xuICAgICAgICB0aHJvdyBlcnI7XG4gICAgICB9XG4gICAgICBhdmFpbCA9IHRoaXMudyAtIHRoaXMucjtcbiAgICB9XG5cbiAgICBpZiAoYXZhaWwgPT09IDAgJiYgdGhpcy5lb2YpIHtcbiAgICAgIHJldHVybiBudWxsO1xuICAgIH0gZWxzZSBpZiAoYXZhaWwgPCBuICYmIHRoaXMuZW9mKSB7XG4gICAgICByZXR1cm4gdGhpcy5idWYuc3ViYXJyYXkodGhpcy5yLCB0aGlzLnIgKyBhdmFpbCk7XG4gICAgfSBlbHNlIGlmIChhdmFpbCA8IG4pIHtcbiAgICAgIHRocm93IG5ldyBCdWZmZXJGdWxsRXJyb3IodGhpcy5idWYuc3ViYXJyYXkodGhpcy5yLCB0aGlzLncpKTtcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5idWYuc3ViYXJyYXkodGhpcy5yLCB0aGlzLnIgKyBuKTtcbiAgfVxufVxuXG5hYnN0cmFjdCBjbGFzcyBBYnN0cmFjdEJ1ZkJhc2Uge1xuICBidWYhOiBVaW50OEFycmF5O1xuICB1c2VkQnVmZmVyQnl0ZXMgPSAwO1xuICBlcnI6IEVycm9yIHwgbnVsbCA9IG51bGw7XG5cbiAgLyoqIFNpemUgcmV0dXJucyB0aGUgc2l6ZSBvZiB0aGUgdW5kZXJseWluZyBidWZmZXIgaW4gYnl0ZXMuICovXG4gIHNpemUoKTogbnVtYmVyIHtcbiAgICByZXR1cm4gdGhpcy5idWYuYnl0ZUxlbmd0aDtcbiAgfVxuXG4gIC8qKiBSZXR1cm5zIGhvdyBtYW55IGJ5dGVzIGFyZSB1bnVzZWQgaW4gdGhlIGJ1ZmZlci4gKi9cbiAgYXZhaWxhYmxlKCk6IG51bWJlciB7XG4gICAgcmV0dXJuIHRoaXMuYnVmLmJ5dGVMZW5ndGggLSB0aGlzLnVzZWRCdWZmZXJCeXRlcztcbiAgfVxuXG4gIC8qKiBidWZmZXJlZCByZXR1cm5zIHRoZSBudW1iZXIgb2YgYnl0ZXMgdGhhdCBoYXZlIGJlZW4gd3JpdHRlbiBpbnRvIHRoZVxuICAgKiBjdXJyZW50IGJ1ZmZlci5cbiAgICovXG4gIGJ1ZmZlcmVkKCk6IG51bWJlciB7XG4gICAgcmV0dXJuIHRoaXMudXNlZEJ1ZmZlckJ5dGVzO1xuICB9XG59XG5cbi8qKiBCdWZXcml0ZXIgaW1wbGVtZW50cyBidWZmZXJpbmcgZm9yIGFuIGRlbm8uV3JpdGVyIG9iamVjdC5cbiAqIElmIGFuIGVycm9yIG9jY3VycyB3cml0aW5nIHRvIGEgV3JpdGVyLCBubyBtb3JlIGRhdGEgd2lsbCBiZVxuICogYWNjZXB0ZWQgYW5kIGFsbCBzdWJzZXF1ZW50IHdyaXRlcywgYW5kIGZsdXNoKCksIHdpbGwgcmV0dXJuIHRoZSBlcnJvci5cbiAqIEFmdGVyIGFsbCBkYXRhIGhhcyBiZWVuIHdyaXR0ZW4sIHRoZSBjbGllbnQgc2hvdWxkIGNhbGwgdGhlXG4gKiBmbHVzaCgpIG1ldGhvZCB0byBndWFyYW50ZWUgYWxsIGRhdGEgaGFzIGJlZW4gZm9yd2FyZGVkIHRvXG4gKiB0aGUgdW5kZXJseWluZyBkZW5vLldyaXRlci5cbiAqL1xuZXhwb3J0IGNsYXNzIEJ1ZldyaXRlciBleHRlbmRzIEFic3RyYWN0QnVmQmFzZSBpbXBsZW1lbnRzIFdyaXRlciB7XG4gIC8qKiByZXR1cm4gbmV3IEJ1ZldyaXRlciB1bmxlc3Mgd3JpdGVyIGlzIEJ1ZldyaXRlciAqL1xuICBzdGF0aWMgY3JlYXRlKHdyaXRlcjogV3JpdGVyLCBzaXplOiBudW1iZXIgPSBERUZBVUxUX0JVRl9TSVpFKTogQnVmV3JpdGVyIHtcbiAgICByZXR1cm4gd3JpdGVyIGluc3RhbmNlb2YgQnVmV3JpdGVyID8gd3JpdGVyIDogbmV3IEJ1ZldyaXRlcih3cml0ZXIsIHNpemUpO1xuICB9XG5cbiAgY29uc3RydWN0b3IocHJpdmF0ZSB3cml0ZXI6IFdyaXRlciwgc2l6ZTogbnVtYmVyID0gREVGQVVMVF9CVUZfU0laRSkge1xuICAgIHN1cGVyKCk7XG4gICAgaWYgKHNpemUgPD0gMCkge1xuICAgICAgc2l6ZSA9IERFRkFVTFRfQlVGX1NJWkU7XG4gICAgfVxuICAgIHRoaXMuYnVmID0gbmV3IFVpbnQ4QXJyYXkoc2l6ZSk7XG4gIH1cblxuICAvKiogRGlzY2FyZHMgYW55IHVuZmx1c2hlZCBidWZmZXJlZCBkYXRhLCBjbGVhcnMgYW55IGVycm9yLCBhbmRcbiAgICogcmVzZXRzIGJ1ZmZlciB0byB3cml0ZSBpdHMgb3V0cHV0IHRvIHcuXG4gICAqL1xuICByZXNldCh3OiBXcml0ZXIpOiB2b2lkIHtcbiAgICB0aGlzLmVyciA9IG51bGw7XG4gICAgdGhpcy51c2VkQnVmZmVyQnl0ZXMgPSAwO1xuICAgIHRoaXMud3JpdGVyID0gdztcbiAgfVxuXG4gIC8qKiBGbHVzaCB3cml0ZXMgYW55IGJ1ZmZlcmVkIGRhdGEgdG8gdGhlIHVuZGVybHlpbmcgaW8uV3JpdGVyLiAqL1xuICBhc3luYyBmbHVzaCgpIHtcbiAgICBpZiAodGhpcy5lcnIgIT09IG51bGwpIHRocm93IHRoaXMuZXJyO1xuICAgIGlmICh0aGlzLnVzZWRCdWZmZXJCeXRlcyA9PT0gMCkgcmV0dXJuO1xuXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHdyaXRlQWxsKHRoaXMud3JpdGVyLCB0aGlzLmJ1Zi5zdWJhcnJheSgwLCB0aGlzLnVzZWRCdWZmZXJCeXRlcykpO1xuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgIHRoaXMuZXJyID0gZTtcbiAgICAgIHRocm93IGU7XG4gICAgfVxuXG4gICAgdGhpcy5idWYgPSBuZXcgVWludDhBcnJheSh0aGlzLmJ1Zi5sZW5ndGgpO1xuICAgIHRoaXMudXNlZEJ1ZmZlckJ5dGVzID0gMDtcbiAgfVxuXG4gIC8qKiBXcml0ZXMgdGhlIGNvbnRlbnRzIG9mIGBkYXRhYCBpbnRvIHRoZSBidWZmZXIuICBJZiB0aGUgY29udGVudHMgd29uJ3QgZnVsbHlcbiAgICogZml0IGludG8gdGhlIGJ1ZmZlciwgdGhvc2UgYnl0ZXMgdGhhdCBjYW4gYXJlIGNvcGllZCBpbnRvIHRoZSBidWZmZXIsIHRoZVxuICAgKiBidWZmZXIgaXMgdGhlIGZsdXNoZWQgdG8gdGhlIHdyaXRlciBhbmQgdGhlIHJlbWFpbmluZyBieXRlcyBhcmUgY29waWVkIGludG9cbiAgICogdGhlIG5vdyBlbXB0eSBidWZmZXIuXG4gICAqXG4gICAqIEByZXR1cm4gdGhlIG51bWJlciBvZiBieXRlcyB3cml0dGVuIHRvIHRoZSBidWZmZXIuXG4gICAqL1xuICBhc3luYyB3cml0ZShkYXRhOiBVaW50OEFycmF5KTogUHJvbWlzZTxudW1iZXI+IHtcbiAgICBpZiAodGhpcy5lcnIgIT09IG51bGwpIHRocm93IHRoaXMuZXJyO1xuICAgIGlmIChkYXRhLmxlbmd0aCA9PT0gMCkgcmV0dXJuIDA7XG5cbiAgICBsZXQgdG90YWxCeXRlc1dyaXR0ZW4gPSAwO1xuICAgIGxldCBudW1CeXRlc1dyaXR0ZW4gPSAwO1xuICAgIHdoaWxlIChkYXRhLmJ5dGVMZW5ndGggPiB0aGlzLmF2YWlsYWJsZSgpKSB7XG4gICAgICBpZiAodGhpcy5idWZmZXJlZCgpID09PSAwKSB7XG4gICAgICAgIC8vIExhcmdlIHdyaXRlLCBlbXB0eSBidWZmZXIuXG4gICAgICAgIC8vIFdyaXRlIGRpcmVjdGx5IGZyb20gZGF0YSB0byBhdm9pZCBjb3B5LlxuICAgICAgICB0cnkge1xuICAgICAgICAgIG51bUJ5dGVzV3JpdHRlbiA9IGF3YWl0IHRoaXMud3JpdGVyLndyaXRlKGRhdGEpO1xuICAgICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgICAgdGhpcy5lcnIgPSBlO1xuICAgICAgICAgIHRocm93IGU7XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIG51bUJ5dGVzV3JpdHRlbiA9IGNvcHkoZGF0YSwgdGhpcy5idWYsIHRoaXMudXNlZEJ1ZmZlckJ5dGVzKTtcbiAgICAgICAgdGhpcy51c2VkQnVmZmVyQnl0ZXMgKz0gbnVtQnl0ZXNXcml0dGVuO1xuICAgICAgICBhd2FpdCB0aGlzLmZsdXNoKCk7XG4gICAgICB9XG4gICAgICB0b3RhbEJ5dGVzV3JpdHRlbiArPSBudW1CeXRlc1dyaXR0ZW47XG4gICAgICBkYXRhID0gZGF0YS5zdWJhcnJheShudW1CeXRlc1dyaXR0ZW4pO1xuICAgIH1cblxuICAgIG51bUJ5dGVzV3JpdHRlbiA9IGNvcHkoZGF0YSwgdGhpcy5idWYsIHRoaXMudXNlZEJ1ZmZlckJ5dGVzKTtcbiAgICB0aGlzLnVzZWRCdWZmZXJCeXRlcyArPSBudW1CeXRlc1dyaXR0ZW47XG4gICAgdG90YWxCeXRlc1dyaXR0ZW4gKz0gbnVtQnl0ZXNXcml0dGVuO1xuICAgIHJldHVybiB0b3RhbEJ5dGVzV3JpdHRlbjtcbiAgfVxufVxuXG4vKiogQnVmV3JpdGVyU3luYyBpbXBsZW1lbnRzIGJ1ZmZlcmluZyBmb3IgYSBkZW5vLldyaXRlclN5bmMgb2JqZWN0LlxuICogSWYgYW4gZXJyb3Igb2NjdXJzIHdyaXRpbmcgdG8gYSBXcml0ZXJTeW5jLCBubyBtb3JlIGRhdGEgd2lsbCBiZVxuICogYWNjZXB0ZWQgYW5kIGFsbCBzdWJzZXF1ZW50IHdyaXRlcywgYW5kIGZsdXNoKCksIHdpbGwgcmV0dXJuIHRoZSBlcnJvci5cbiAqIEFmdGVyIGFsbCBkYXRhIGhhcyBiZWVuIHdyaXR0ZW4sIHRoZSBjbGllbnQgc2hvdWxkIGNhbGwgdGhlXG4gKiBmbHVzaCgpIG1ldGhvZCB0byBndWFyYW50ZWUgYWxsIGRhdGEgaGFzIGJlZW4gZm9yd2FyZGVkIHRvXG4gKiB0aGUgdW5kZXJseWluZyBkZW5vLldyaXRlclN5bmMuXG4gKi9cbmV4cG9ydCBjbGFzcyBCdWZXcml0ZXJTeW5jIGV4dGVuZHMgQWJzdHJhY3RCdWZCYXNlIGltcGxlbWVudHMgV3JpdGVyU3luYyB7XG4gIC8qKiByZXR1cm4gbmV3IEJ1ZldyaXRlclN5bmMgdW5sZXNzIHdyaXRlciBpcyBCdWZXcml0ZXJTeW5jICovXG4gIHN0YXRpYyBjcmVhdGUoXG4gICAgd3JpdGVyOiBXcml0ZXJTeW5jLFxuICAgIHNpemU6IG51bWJlciA9IERFRkFVTFRfQlVGX1NJWkUsXG4gICk6IEJ1ZldyaXRlclN5bmMge1xuICAgIHJldHVybiB3cml0ZXIgaW5zdGFuY2VvZiBCdWZXcml0ZXJTeW5jXG4gICAgICA/IHdyaXRlclxuICAgICAgOiBuZXcgQnVmV3JpdGVyU3luYyh3cml0ZXIsIHNpemUpO1xuICB9XG5cbiAgY29uc3RydWN0b3IocHJpdmF0ZSB3cml0ZXI6IFdyaXRlclN5bmMsIHNpemU6IG51bWJlciA9IERFRkFVTFRfQlVGX1NJWkUpIHtcbiAgICBzdXBlcigpO1xuICAgIGlmIChzaXplIDw9IDApIHtcbiAgICAgIHNpemUgPSBERUZBVUxUX0JVRl9TSVpFO1xuICAgIH1cbiAgICB0aGlzLmJ1ZiA9IG5ldyBVaW50OEFycmF5KHNpemUpO1xuICB9XG5cbiAgLyoqIERpc2NhcmRzIGFueSB1bmZsdXNoZWQgYnVmZmVyZWQgZGF0YSwgY2xlYXJzIGFueSBlcnJvciwgYW5kXG4gICAqIHJlc2V0cyBidWZmZXIgdG8gd3JpdGUgaXRzIG91dHB1dCB0byB3LlxuICAgKi9cbiAgcmVzZXQodzogV3JpdGVyU3luYyk6IHZvaWQge1xuICAgIHRoaXMuZXJyID0gbnVsbDtcbiAgICB0aGlzLnVzZWRCdWZmZXJCeXRlcyA9IDA7XG4gICAgdGhpcy53cml0ZXIgPSB3O1xuICB9XG5cbiAgLyoqIEZsdXNoIHdyaXRlcyBhbnkgYnVmZmVyZWQgZGF0YSB0byB0aGUgdW5kZXJseWluZyBpby5Xcml0ZXJTeW5jLiAqL1xuICBmbHVzaCgpOiB2b2lkIHtcbiAgICBpZiAodGhpcy5lcnIgIT09IG51bGwpIHRocm93IHRoaXMuZXJyO1xuICAgIGlmICh0aGlzLnVzZWRCdWZmZXJCeXRlcyA9PT0gMCkgcmV0dXJuO1xuXG4gICAgdHJ5IHtcbiAgICAgIHdyaXRlQWxsU3luYyh0aGlzLndyaXRlciwgdGhpcy5idWYuc3ViYXJyYXkoMCwgdGhpcy51c2VkQnVmZmVyQnl0ZXMpKTtcbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICB0aGlzLmVyciA9IGU7XG4gICAgICB0aHJvdyBlO1xuICAgIH1cblxuICAgIHRoaXMuYnVmID0gbmV3IFVpbnQ4QXJyYXkodGhpcy5idWYubGVuZ3RoKTtcbiAgICB0aGlzLnVzZWRCdWZmZXJCeXRlcyA9IDA7XG4gIH1cblxuICAvKiogV3JpdGVzIHRoZSBjb250ZW50cyBvZiBgZGF0YWAgaW50byB0aGUgYnVmZmVyLiAgSWYgdGhlIGNvbnRlbnRzIHdvbid0IGZ1bGx5XG4gICAqIGZpdCBpbnRvIHRoZSBidWZmZXIsIHRob3NlIGJ5dGVzIHRoYXQgY2FuIGFyZSBjb3BpZWQgaW50byB0aGUgYnVmZmVyLCB0aGVcbiAgICogYnVmZmVyIGlzIHRoZSBmbHVzaGVkIHRvIHRoZSB3cml0ZXIgYW5kIHRoZSByZW1haW5pbmcgYnl0ZXMgYXJlIGNvcGllZCBpbnRvXG4gICAqIHRoZSBub3cgZW1wdHkgYnVmZmVyLlxuICAgKlxuICAgKiBAcmV0dXJuIHRoZSBudW1iZXIgb2YgYnl0ZXMgd3JpdHRlbiB0byB0aGUgYnVmZmVyLlxuICAgKi9cbiAgd3JpdGVTeW5jKGRhdGE6IFVpbnQ4QXJyYXkpOiBudW1iZXIge1xuICAgIGlmICh0aGlzLmVyciAhPT0gbnVsbCkgdGhyb3cgdGhpcy5lcnI7XG4gICAgaWYgKGRhdGEubGVuZ3RoID09PSAwKSByZXR1cm4gMDtcblxuICAgIGxldCB0b3RhbEJ5dGVzV3JpdHRlbiA9IDA7XG4gICAgbGV0IG51bUJ5dGVzV3JpdHRlbiA9IDA7XG4gICAgd2hpbGUgKGRhdGEuYnl0ZUxlbmd0aCA+IHRoaXMuYXZhaWxhYmxlKCkpIHtcbiAgICAgIGlmICh0aGlzLmJ1ZmZlcmVkKCkgPT09IDApIHtcbiAgICAgICAgLy8gTGFyZ2Ugd3JpdGUsIGVtcHR5IGJ1ZmZlci5cbiAgICAgICAgLy8gV3JpdGUgZGlyZWN0bHkgZnJvbSBkYXRhIHRvIGF2b2lkIGNvcHkuXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgbnVtQnl0ZXNXcml0dGVuID0gdGhpcy53cml0ZXIud3JpdGVTeW5jKGRhdGEpO1xuICAgICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgICAgdGhpcy5lcnIgPSBlO1xuICAgICAgICAgIHRocm93IGU7XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIG51bUJ5dGVzV3JpdHRlbiA9IGNvcHkoZGF0YSwgdGhpcy5idWYsIHRoaXMudXNlZEJ1ZmZlckJ5dGVzKTtcbiAgICAgICAgdGhpcy51c2VkQnVmZmVyQnl0ZXMgKz0gbnVtQnl0ZXNXcml0dGVuO1xuICAgICAgICB0aGlzLmZsdXNoKCk7XG4gICAgICB9XG4gICAgICB0b3RhbEJ5dGVzV3JpdHRlbiArPSBudW1CeXRlc1dyaXR0ZW47XG4gICAgICBkYXRhID0gZGF0YS5zdWJhcnJheShudW1CeXRlc1dyaXR0ZW4pO1xuICAgIH1cblxuICAgIG51bUJ5dGVzV3JpdHRlbiA9IGNvcHkoZGF0YSwgdGhpcy5idWYsIHRoaXMudXNlZEJ1ZmZlckJ5dGVzKTtcbiAgICB0aGlzLnVzZWRCdWZmZXJCeXRlcyArPSBudW1CeXRlc1dyaXR0ZW47XG4gICAgdG90YWxCeXRlc1dyaXR0ZW4gKz0gbnVtQnl0ZXNXcml0dGVuO1xuICAgIHJldHVybiB0b3RhbEJ5dGVzV3JpdHRlbjtcbiAgfVxufVxuXG4vKiogR2VuZXJhdGUgbG9uZ2VzdCBwcm9wZXIgcHJlZml4IHdoaWNoIGlzIGFsc28gc3VmZml4IGFycmF5LiAqL1xuZnVuY3Rpb24gY3JlYXRlTFBTKHBhdDogVWludDhBcnJheSk6IFVpbnQ4QXJyYXkge1xuICBjb25zdCBscHMgPSBuZXcgVWludDhBcnJheShwYXQubGVuZ3RoKTtcbiAgbHBzWzBdID0gMDtcbiAgbGV0IHByZWZpeEVuZCA9IDA7XG4gIGxldCBpID0gMTtcbiAgd2hpbGUgKGkgPCBscHMubGVuZ3RoKSB7XG4gICAgaWYgKHBhdFtpXSA9PSBwYXRbcHJlZml4RW5kXSkge1xuICAgICAgcHJlZml4RW5kKys7XG4gICAgICBscHNbaV0gPSBwcmVmaXhFbmQ7XG4gICAgICBpKys7XG4gICAgfSBlbHNlIGlmIChwcmVmaXhFbmQgPT09IDApIHtcbiAgICAgIGxwc1tpXSA9IDA7XG4gICAgICBpKys7XG4gICAgfSBlbHNlIHtcbiAgICAgIHByZWZpeEVuZCA9IGxwc1twcmVmaXhFbmQgLSAxXTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIGxwcztcbn1cblxuLyoqIFJlYWQgZGVsaW1pdGVkIGJ5dGVzIGZyb20gYSBSZWFkZXIuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24qIHJlYWREZWxpbShcbiAgcmVhZGVyOiBSZWFkZXIsXG4gIGRlbGltOiBVaW50OEFycmF5LFxuKTogQXN5bmNJdGVyYWJsZUl0ZXJhdG9yPFVpbnQ4QXJyYXk+IHtcbiAgLy8gQXZvaWQgdW5pY29kZSBwcm9ibGVtc1xuICBjb25zdCBkZWxpbUxlbiA9IGRlbGltLmxlbmd0aDtcbiAgY29uc3QgZGVsaW1MUFMgPSBjcmVhdGVMUFMoZGVsaW0pO1xuICBjb25zdCBjaHVua3MgPSBuZXcgQnl0ZXNMaXN0KCk7XG4gIGNvbnN0IGJ1ZlNpemUgPSBNYXRoLm1heCgxMDI0LCBkZWxpbUxlbiArIDEpO1xuXG4gIC8vIE1vZGlmaWVkIEtNUFxuICBsZXQgaW5zcGVjdEluZGV4ID0gMDtcbiAgbGV0IG1hdGNoSW5kZXggPSAwO1xuICB3aGlsZSAodHJ1ZSkge1xuICAgIGNvbnN0IGluc3BlY3RBcnIgPSBuZXcgVWludDhBcnJheShidWZTaXplKTtcbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCByZWFkZXIucmVhZChpbnNwZWN0QXJyKTtcbiAgICBpZiAocmVzdWx0ID09PSBudWxsKSB7XG4gICAgICAvLyBZaWVsZCBsYXN0IGNodW5rLlxuICAgICAgeWllbGQgY2h1bmtzLmNvbmNhdCgpO1xuICAgICAgcmV0dXJuO1xuICAgIH0gZWxzZSBpZiAocmVzdWx0IDwgMCkge1xuICAgICAgLy8gRGlzY2FyZCBhbGwgcmVtYWluaW5nIGFuZCBzaWxlbnRseSBmYWlsLlxuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBjaHVua3MuYWRkKGluc3BlY3RBcnIsIDAsIHJlc3VsdCk7XG4gICAgbGV0IGxvY2FsSW5kZXggPSAwO1xuICAgIHdoaWxlIChpbnNwZWN0SW5kZXggPCBjaHVua3Muc2l6ZSgpKSB7XG4gICAgICBpZiAoaW5zcGVjdEFycltsb2NhbEluZGV4XSA9PT0gZGVsaW1bbWF0Y2hJbmRleF0pIHtcbiAgICAgICAgaW5zcGVjdEluZGV4Kys7XG4gICAgICAgIGxvY2FsSW5kZXgrKztcbiAgICAgICAgbWF0Y2hJbmRleCsrO1xuICAgICAgICBpZiAobWF0Y2hJbmRleCA9PT0gZGVsaW1MZW4pIHtcbiAgICAgICAgICAvLyBGdWxsIG1hdGNoXG4gICAgICAgICAgY29uc3QgbWF0Y2hFbmQgPSBpbnNwZWN0SW5kZXggLSBkZWxpbUxlbjtcbiAgICAgICAgICBjb25zdCByZWFkeUJ5dGVzID0gY2h1bmtzLnNsaWNlKDAsIG1hdGNoRW5kKTtcbiAgICAgICAgICB5aWVsZCByZWFkeUJ5dGVzO1xuICAgICAgICAgIC8vIFJlc2V0IG1hdGNoLCBkaWZmZXJlbnQgZnJvbSBLTVAuXG4gICAgICAgICAgY2h1bmtzLnNoaWZ0KGluc3BlY3RJbmRleCk7XG4gICAgICAgICAgaW5zcGVjdEluZGV4ID0gMDtcbiAgICAgICAgICBtYXRjaEluZGV4ID0gMDtcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgaWYgKG1hdGNoSW5kZXggPT09IDApIHtcbiAgICAgICAgICBpbnNwZWN0SW5kZXgrKztcbiAgICAgICAgICBsb2NhbEluZGV4Kys7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgbWF0Y2hJbmRleCA9IGRlbGltTFBTW21hdGNoSW5kZXggLSAxXTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgfVxufVxuXG4vKiogUmVhZCBkZWxpbWl0ZWQgc3RyaW5ncyBmcm9tIGEgUmVhZGVyLiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uKiByZWFkU3RyaW5nRGVsaW0oXG4gIHJlYWRlcjogUmVhZGVyLFxuICBkZWxpbTogc3RyaW5nLFxuICBkZWNvZGVyT3B0cz86IHtcbiAgICBlbmNvZGluZz86IHN0cmluZztcbiAgICBmYXRhbD86IGJvb2xlYW47XG4gICAgaWdub3JlQk9NPzogYm9vbGVhbjtcbiAgfSxcbik6IEFzeW5jSXRlcmFibGVJdGVyYXRvcjxzdHJpbmc+IHtcbiAgY29uc3QgZW5jb2RlciA9IG5ldyBUZXh0RW5jb2RlcigpO1xuICBjb25zdCBkZWNvZGVyID0gbmV3IFRleHREZWNvZGVyKGRlY29kZXJPcHRzPy5lbmNvZGluZywgZGVjb2Rlck9wdHMpO1xuICBmb3IgYXdhaXQgKGNvbnN0IGNodW5rIG9mIHJlYWREZWxpbShyZWFkZXIsIGVuY29kZXIuZW5jb2RlKGRlbGltKSkpIHtcbiAgICB5aWVsZCBkZWNvZGVyLmRlY29kZShjaHVuayk7XG4gIH1cbn1cblxuLyoqIFJlYWQgc3RyaW5ncyBsaW5lLWJ5LWxpbmUgZnJvbSBhIFJlYWRlci4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiogcmVhZExpbmVzKFxuICByZWFkZXI6IFJlYWRlcixcbiAgZGVjb2Rlck9wdHM/OiB7XG4gICAgZW5jb2Rpbmc/OiBzdHJpbmc7XG4gICAgZmF0YWw/OiBib29sZWFuO1xuICAgIGlnbm9yZUJPTT86IGJvb2xlYW47XG4gIH0sXG4pOiBBc3luY0l0ZXJhYmxlSXRlcmF0b3I8c3RyaW5nPiB7XG4gIGZvciBhd2FpdCAobGV0IGNodW5rIG9mIHJlYWRTdHJpbmdEZWxpbShyZWFkZXIsIFwiXFxuXCIsIGRlY29kZXJPcHRzKSkge1xuICAgIC8vIEZpbmRpbmcgYSBDUiBhdCB0aGUgZW5kIG9mIHRoZSBsaW5lIGlzIGV2aWRlbmNlIG9mIGFcbiAgICAvLyBcIlxcclxcblwiIGF0IHRoZSBlbmQgb2YgdGhlIGxpbmUuIFRoZSBcIlxcclwiIHBhcnQgc2hvdWxkIGJlXG4gICAgLy8gcmVtb3ZlZCB0b28uXG4gICAgaWYgKGNodW5rLmVuZHNXaXRoKFwiXFxyXCIpKSB7XG4gICAgICBjaHVuayA9IGNodW5rLnNsaWNlKDAsIC0xKTtcbiAgICB9XG4gICAgeWllbGQgY2h1bms7XG4gIH1cbn1cbiJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFTQSxNQUFNLEdBQUcsSUFBSSxRQUFRLENBQWlCO0FBQ3RDLE1BQU0sR0FBRyxNQUFNLFFBQVEsQ0FBb0I7QUFDM0MsTUFBTSxHQUFHLFNBQVMsUUFBUSxDQUF3QjtBQUNsRCxNQUFNLEdBQUcsUUFBUSxFQUFFLFlBQVksUUFBUSxDQUFXO0FBRWxELEtBQUssQ0FBQyxnQkFBZ0IsR0FBRyxJQUFJO0FBQzdCLEtBQUssQ0FBQyxZQUFZLEdBQUcsRUFBRTtBQUN2QixLQUFLLENBQUMsMkJBQTJCLEdBQUcsR0FBRztBQUN2QyxLQUFLLENBQUMsRUFBRSxHQUFHLENBQUksSUFBQyxVQUFVLENBQUMsQ0FBQztBQUM1QixLQUFLLENBQUMsRUFBRSxHQUFHLENBQUksSUFBQyxVQUFVLENBQUMsQ0FBQztBQUU1QixNQUFNLE9BQU8sZUFBZSxTQUFTLEtBQUs7SUFFckIsT0FBbUI7SUFEdEMsSUFBSSxHQUFHLENBQWlCO2dCQUNMLE9BQW1CLENBQUUsQ0FBQztRQUN2QyxLQUFLLENBQUMsQ0FBYTthQURGLE9BQW1CLEdBQW5CLE9BQW1CO0lBRXRDLENBQUM7O0FBR0gsTUFBTSxPQUFPLGdCQUFnQixTQUFTLEtBQUs7SUFDekMsSUFBSSxHQUFHLENBQWtCO0lBQ3pCLE9BQU87aUJBQ08sQ0FBQztRQUNiLEtBQUssQ0FBQyxDQUFxRDtJQUM3RCxDQUFDOztBQVNILEVBQTBELEFBQTFELHNE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