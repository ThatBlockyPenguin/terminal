// Copyright 2018-2021 the Deno authors. All rights reserved. MIT license.
import { equals, indexOf, lastIndexOf, startsWith } from "../bytes/mod.ts";
import { copyN } from "../io/ioutil.ts";
import { MultiReader } from "../io/readers.ts";
import { extname } from "../path/mod.ts";
import { BufReader, BufWriter } from "../io/bufio.ts";
import { assert } from "../_util/assert.ts";
import { TextProtoReader } from "../textproto/mod.ts";
import { hasOwnProperty } from "../_util/has_own_property.ts";
import { Buffer } from "../io/buffer.ts";
/** Type guard for FormFile */ // deno-lint-ignore no-explicit-any
export function isFormFile(x) {
    return hasOwnProperty(x, "filename") && hasOwnProperty(x, "type");
}
function randomBoundary() {
    let boundary = "--------------------------";
    for(let i = 0; i < 24; i++){
        boundary += Math.floor(Math.random() * 16).toString(16);
    }
    return boundary;
}
const encoder = new TextEncoder();
/**
 * Checks whether `buf` should be considered to match the boundary.
 *
 * The prefix is "--boundary" or "\r\n--boundary" or "\n--boundary", and the
 * caller has verified already that `hasPrefix(buf, prefix)` is true.
 *
 * `matchAfterPrefix()` returns `1` if the buffer does match the boundary,
 * meaning the prefix is followed by a dash, space, tab, cr, nl, or EOF.
 *
 * It returns `-1` if the buffer definitely does NOT match the boundary,
 * meaning the prefix is followed by some other character.
 * For example, "--foobar" does not match "--foo".
 *
 * It returns `0` more input needs to be read to make the decision,
 * meaning that `buf.length` and `prefix.length` are the same.
 */ export function matchAfterPrefix(buf, prefix, eof) {
    if (buf.length === prefix.length) {
        return eof ? 1 : 0;
    }
    const c = buf[prefix.length];
    if (c === " ".charCodeAt(0) || c === "\t".charCodeAt(0) || c === "\r".charCodeAt(0) || c === "\n".charCodeAt(0) || c === "-".charCodeAt(0)) {
        return 1;
    }
    return -1;
}
/**
 * Scans `buf` to identify how much of it can be safely returned as part of the
 * `PartReader` body.
 *
 * @param buf - The buffer to search for boundaries.
 * @param dashBoundary - Is "--boundary".
 * @param newLineDashBoundary - Is "\r\n--boundary" or "\n--boundary", depending
 * on what mode we are in. The comments below (and the name) assume
 * "\n--boundary", but either is accepted.
 * @param total - The number of bytes read out so far. If total == 0, then a
 * leading "--boundary" is recognized.
 * @param eof - Whether `buf` contains the final bytes in the stream before EOF.
 * If `eof` is false, more bytes are expected to follow.
 * @returns The number of data bytes from buf that can be returned as part of
 * the `PartReader` body.
 */ export function scanUntilBoundary(buf, dashBoundary, newLineDashBoundary, total, eof) {
    if (total === 0) {
        // At beginning of body, allow dashBoundary.
        if (startsWith(buf, dashBoundary)) {
            switch(matchAfterPrefix(buf, dashBoundary, eof)){
                case -1:
                    return dashBoundary.length;
                case 0:
                    return 0;
                case 1:
                    return null;
            }
        }
        if (startsWith(dashBoundary, buf)) {
            return 0;
        }
    }
    // Search for "\n--boundary".
    const i = indexOf(buf, newLineDashBoundary);
    if (i >= 0) {
        switch(matchAfterPrefix(buf.slice(i), newLineDashBoundary, eof)){
            case -1:
                return i + newLineDashBoundary.length;
            case 0:
                return i;
            case 1:
                return i > 0 ? i : null;
        }
    }
    if (startsWith(newLineDashBoundary, buf)) {
        return 0;
    }
    // Otherwise, anything up to the final \n is not part of the boundary and so
    // must be part of the body. Also, if the section from the final \n onward is
    // not a prefix of the boundary, it too must be part of the body.
    const j = lastIndexOf(buf, newLineDashBoundary.slice(0, 1));
    if (j >= 0 && startsWith(newLineDashBoundary, buf.slice(j))) {
        return j;
    }
    return buf.length;
}
class PartReader {
    mr;
    headers;
    n = 0;
    total = 0;
    constructor(mr, headers){
        this.mr = mr;
        this.headers = headers;
    }
    async read(p) {
        const br = this.mr.bufReader;
        // Read into buffer until we identify some data to return,
        // or we find a reason to stop (boundary or EOF).
        let peekLength = 1;
        while(this.n === 0){
            peekLength = Math.max(peekLength, br.buffered());
            const peekBuf = await br.peek(peekLength);
            if (peekBuf === null) {
                throw new Deno.errors.UnexpectedEof();
            }
            const eof = peekBuf.length < peekLength;
            this.n = scanUntilBoundary(peekBuf, this.mr.dashBoundary, this.mr.newLineDashBoundary, this.total, eof);
            if (this.n === 0) {
                // Force buffered I/O to read more into buffer.
                assert(eof === false);
                peekLength++;
            }
        }
        if (this.n === null) {
            return null;
        }
        const nread = Math.min(p.length, this.n);
        const buf = p.subarray(0, nread);
        const r = await br.readFull(buf);
        assert(r === buf);
        this.n -= nread;
        this.total += nread;
        return nread;
    }
    close() {
    }
    contentDisposition;
    contentDispositionParams;
    getContentDispositionParams() {
        if (this.contentDispositionParams) return this.contentDispositionParams;
        const cd = this.headers.get("content-disposition");
        const params = {
        };
        assert(cd != null, "content-disposition must be set");
        const comps = decodeURI(cd).split(";");
        this.contentDisposition = comps[0];
        comps.slice(1).map((v)=>v.trim()
        ).map((kv)=>{
            const [k, v] = kv.split("=");
            if (v) {
                const s = v.charAt(0);
                const e = v.charAt(v.length - 1);
                if (s === e && s === '"' || s === "'") {
                    params[k] = v.substr(1, v.length - 2);
                } else {
                    params[k] = v;
                }
            }
        });
        return this.contentDispositionParams = params;
    }
    get fileName() {
        return this.getContentDispositionParams()["filename"];
    }
    get formName() {
        const p = this.getContentDispositionParams();
        if (this.contentDisposition === "form-data") {
            return p["name"];
        }
        return "";
    }
}
function skipLWSPChar(u) {
    const ret = new Uint8Array(u.length);
    const sp = " ".charCodeAt(0);
    const ht = "\t".charCodeAt(0);
    let j = 0;
    for(let i = 0; i < u.length; i++){
        if (u[i] === sp || u[i] === ht) continue;
        ret[j++] = u[i];
    }
    return ret.slice(0, j);
}
/** Reader for parsing multipart/form-data */ export class MultipartReader {
    boundary;
    newLine;
    newLineDashBoundary;
    dashBoundaryDash;
    dashBoundary;
    bufReader;
    constructor(reader, boundary){
        this.boundary = boundary;
        this.newLine = encoder.encode("\r\n");
        this.newLineDashBoundary = encoder.encode(`\r\n--${boundary}`);
        this.dashBoundaryDash = encoder.encode(`--${this.boundary}--`);
        this.dashBoundary = encoder.encode(`--${this.boundary}`);
        this.bufReader = new BufReader(reader);
    }
    async readForm(maxMemoryOrOptions) {
        const options = typeof maxMemoryOrOptions === "number" ? {
            maxMemory: maxMemoryOrOptions
        } : maxMemoryOrOptions;
        let maxMemory = options?.maxMemory ?? 10 << 20;
        const fileMap = new Map();
        const valueMap = new Map();
        let maxValueBytes = maxMemory + (10 << 20);
        const buf = new Buffer(new Uint8Array(maxValueBytes));
        for(;;){
            const p = await this.nextPart();
            if (p === null) {
                break;
            }
            if (p.formName === "") {
                continue;
            }
            buf.reset();
            if (!p.fileName) {
                // value
                const n = await copyN(p, buf, maxValueBytes);
                maxValueBytes -= n;
                if (maxValueBytes < 0) {
                    throw new RangeError("message too large");
                }
                const value = new TextDecoder().decode(buf.bytes());
                valueMap.set(p.formName, value);
                continue;
            }
            // file
            let formFile;
            const n = await copyN(p, buf, maxValueBytes);
            const contentType = p.headers.get("content-type");
            assert(contentType != null, "content-type must be set");
            if (n > maxMemory) {
                // too big, write to disk and flush buffer
                const ext = extname(p.fileName);
                const filepath = await Deno.makeTempFile({
                    dir: options?.dir ?? ".",
                    prefix: options?.prefix ?? "multipart-",
                    suffix: options?.suffix ?? ext
                });
                const file = await Deno.open(filepath, {
                    write: true
                });
                try {
                    const size = await Deno.copy(new MultiReader(buf, p), file);
                    file.close();
                    formFile = {
                        filename: p.fileName,
                        type: contentType,
                        tempfile: filepath,
                        size
                    };
                } catch (e) {
                    await Deno.remove(filepath);
                    throw e;
                }
            } else {
                formFile = {
                    filename: p.fileName,
                    type: contentType,
                    content: buf.bytes(),
                    size: buf.length
                };
                maxMemory -= n;
                maxValueBytes -= n;
            }
            if (formFile) {
                const mapVal = fileMap.get(p.formName);
                if (mapVal !== undefined) {
                    if (Array.isArray(mapVal)) {
                        mapVal.push(formFile);
                    } else {
                        fileMap.set(p.formName, [
                            mapVal,
                            formFile
                        ]);
                    }
                } else {
                    fileMap.set(p.formName, formFile);
                }
            }
        }
        return multipartFormData(fileMap, valueMap);
    }
    currentPart;
    partsRead = 0;
    async nextPart() {
        if (this.currentPart) {
            this.currentPart.close();
        }
        if (equals(this.dashBoundary, encoder.encode("--"))) {
            throw new Error("boundary is empty");
        }
        let expectNewPart = false;
        for(;;){
            const line = await this.bufReader.readSlice("\n".charCodeAt(0));
            if (line === null) {
                throw new Deno.errors.UnexpectedEof();
            }
            if (this.isBoundaryDelimiterLine(line)) {
                this.partsRead++;
                const r = new TextProtoReader(this.bufReader);
                const headers = await r.readMIMEHeader();
                if (headers === null) {
                    throw new Deno.errors.UnexpectedEof();
                }
                const np = new PartReader(this, headers);
                this.currentPart = np;
                return np;
            }
            if (this.isFinalBoundary(line)) {
                return null;
            }
            if (expectNewPart) {
                throw new Error(`expecting a new Part; got line ${line}`);
            }
            if (this.partsRead === 0) {
                continue;
            }
            if (equals(line, this.newLine)) {
                expectNewPart = true;
                continue;
            }
            throw new Error(`unexpected line in nextPart(): ${line}`);
        }
    }
    isFinalBoundary(line) {
        if (!startsWith(line, this.dashBoundaryDash)) {
            return false;
        }
        const rest = line.slice(this.dashBoundaryDash.length, line.length);
        return rest.length === 0 || equals(skipLWSPChar(rest), this.newLine);
    }
    isBoundaryDelimiterLine(line) {
        if (!startsWith(line, this.dashBoundary)) {
            return false;
        }
        const rest = line.slice(this.dashBoundary.length);
        return equals(skipLWSPChar(rest), this.newLine);
    }
}
function multipartFormData(fileMap, valueMap) {
    function file(key) {
        return fileMap.get(key);
    }
    function value(key) {
        return valueMap.get(key);
    }
    function* entries() {
        yield* fileMap;
        yield* valueMap;
    }
    async function removeAll() {
        const promises = [];
        for (const val of fileMap.values()){
            if (Array.isArray(val)) {
                for (const subVal of val){
                    if (!subVal.tempfile) continue;
                    promises.push(Deno.remove(subVal.tempfile));
                }
            } else {
                if (!val.tempfile) continue;
                promises.push(Deno.remove(val.tempfile));
            }
        }
        await Promise.all(promises);
    }
    return {
        file,
        value,
        entries,
        removeAll,
        [Symbol.iterator] () {
            return entries();
        }
    };
}
class PartWriter {
    writer;
    boundary;
    headers;
    closed = false;
    partHeader;
    headersWritten = false;
    constructor(writer, boundary, headers, isFirstBoundary){
        this.writer = writer;
        this.boundary = boundary;
        this.headers = headers;
        let buf = "";
        if (isFirstBoundary) {
            buf += `--${boundary}\r\n`;
        } else {
            buf += `\r\n--${boundary}\r\n`;
        }
        for (const [key, value] of headers.entries()){
            buf += `${key}: ${value}\r\n`;
        }
        buf += `\r\n`;
        this.partHeader = buf;
    }
    close() {
        this.closed = true;
    }
    async write(p) {
        if (this.closed) {
            throw new Error("part is closed");
        }
        if (!this.headersWritten) {
            await this.writer.write(encoder.encode(this.partHeader));
            this.headersWritten = true;
        }
        return this.writer.write(p);
    }
}
function checkBoundary(b) {
    if (b.length < 1 || b.length > 70) {
        throw new Error(`invalid boundary length: ${b.length}`);
    }
    const end = b.length - 1;
    for(let i = 0; i < end; i++){
        const c = b.charAt(i);
        if (!c.match(/[a-zA-Z0-9'()+_,\-./:=?]/) || c === " " && i !== end) {
            throw new Error("invalid boundary character: " + c);
        }
    }
    return b;
}
/** Writer for creating multipart/form-data */ export class MultipartWriter {
    writer;
    _boundary;
    get boundary() {
        return this._boundary;
    }
    lastPart;
    bufWriter;
    isClosed = false;
    constructor(writer, boundary){
        this.writer = writer;
        if (boundary !== void 0) {
            this._boundary = checkBoundary(boundary);
        } else {
            this._boundary = randomBoundary();
        }
        this.bufWriter = new BufWriter(writer);
    }
    formDataContentType() {
        return `multipart/form-data; boundary=${this.boundary}`;
    }
    createPart(headers) {
        if (this.isClosed) {
            throw new Error("multipart: writer is closed");
        }
        if (this.lastPart) {
            this.lastPart.close();
        }
        const part = new PartWriter(this.writer, this.boundary, headers, !this.lastPart);
        this.lastPart = part;
        return part;
    }
    createFormFile(field, filename) {
        const h = new Headers();
        h.set("Content-Disposition", `form-data; name="${field}"; filename="${filename}"`);
        h.set("Content-Type", "application/octet-stream");
        return this.createPart(h);
    }
    createFormField(field) {
        const h = new Headers();
        h.set("Content-Disposition", `form-data; name="${field}"`);
        h.set("Content-Type", "application/octet-stream");
        return this.createPart(h);
    }
    async writeField(field, value) {
        const f = await this.createFormField(field);
        await f.write(encoder.encode(value));
    }
    async writeFile(field, filename, file) {
        const f = await this.createFormFile(field, filename);
        await Deno.copy(file, f);
    }
    flush() {
        return this.bufWriter.flush();
    }
    /** Close writer. No additional data can be written to stream */ async close() {
        if (this.isClosed) {
            throw new Error("multipart: writer is closed");
        }
        if (this.lastPart) {
            this.lastPart.close();
            this.lastPart = void 0;
        }
        await this.writer.write(encoder.encode(`\r\n--${this.boundary}--\r\n`));
        await this.flush();
        this.isClosed = true;
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbImh0dHBzOi8vZGVuby5sYW5kL3N0ZEAwLjk5LjAvbWltZS9tdWx0aXBhcnQudHMiXSwic291cmNlc0NvbnRlbnQiOlsiLy8gQ29weXJpZ2h0IDIwMTgtMjAyMSB0aGUgRGVubyBhdXRob3JzLiBBbGwgcmlnaHRzIHJlc2VydmVkLiBNSVQgbGljZW5zZS5cbmltcG9ydCB7IGVxdWFscywgaW5kZXhPZiwgbGFzdEluZGV4T2YsIHN0YXJ0c1dpdGggfSBmcm9tIFwiLi4vYnl0ZXMvbW9kLnRzXCI7XG5pbXBvcnQgeyBjb3B5TiB9IGZyb20gXCIuLi9pby9pb3V0aWwudHNcIjtcbmltcG9ydCB7IE11bHRpUmVhZGVyIH0gZnJvbSBcIi4uL2lvL3JlYWRlcnMudHNcIjtcbmltcG9ydCB7IGV4dG5hbWUgfSBmcm9tIFwiLi4vcGF0aC9tb2QudHNcIjtcbmltcG9ydCB7IEJ1ZlJlYWRlciwgQnVmV3JpdGVyIH0gZnJvbSBcIi4uL2lvL2J1ZmlvLnRzXCI7XG5pbXBvcnQgeyBhc3NlcnQgfSBmcm9tIFwiLi4vX3V0aWwvYXNzZXJ0LnRzXCI7XG5pbXBvcnQgeyBUZXh0UHJvdG9SZWFkZXIgfSBmcm9tIFwiLi4vdGV4dHByb3RvL21vZC50c1wiO1xuaW1wb3J0IHsgaGFzT3duUHJvcGVydHkgfSBmcm9tIFwiLi4vX3V0aWwvaGFzX293bl9wcm9wZXJ0eS50c1wiO1xuaW1wb3J0IHsgQnVmZmVyIH0gZnJvbSBcIi4uL2lvL2J1ZmZlci50c1wiO1xuXG4vKiogRm9ybUZpbGUgb2JqZWN0ICovXG5leHBvcnQgaW50ZXJmYWNlIEZvcm1GaWxlIHtcbiAgLyoqIGZpbGVuYW1lICAqL1xuICBmaWxlbmFtZTogc3RyaW5nO1xuICAvKiogY29udGVudC10eXBlIGhlYWRlciB2YWx1ZSBvZiBmaWxlICovXG4gIHR5cGU6IHN0cmluZztcbiAgLyoqIGJ5dGUgc2l6ZSBvZiBmaWxlICovXG4gIHNpemU6IG51bWJlcjtcbiAgLyoqIGluLW1lbW9yeSBjb250ZW50IG9mIGZpbGUuIEVpdGhlciBjb250ZW50IG9yIHRlbXBmaWxlIGlzIHNldCAgKi9cbiAgY29udGVudD86IFVpbnQ4QXJyYXk7XG4gIC8qKiB0ZW1wb3JhbCBmaWxlIHBhdGguXG4gICAqIFNldCBpZiBmaWxlIHNpemUgaXMgYmlnZ2VyIHRoYW4gc3BlY2lmaWVkIG1heC1tZW1vcnkgc2l6ZSBhdCByZWFkaW5nIGZvcm1cbiAgICogKi9cbiAgdGVtcGZpbGU/OiBzdHJpbmc7XG59XG5cbi8qKiBUeXBlIGd1YXJkIGZvciBGb3JtRmlsZSAqL1xuLy8gZGVuby1saW50LWlnbm9yZSBuby1leHBsaWNpdC1hbnlcbmV4cG9ydCBmdW5jdGlvbiBpc0Zvcm1GaWxlKHg6IGFueSk6IHggaXMgRm9ybUZpbGUge1xuICByZXR1cm4gaGFzT3duUHJvcGVydHkoeCwgXCJmaWxlbmFtZVwiKSAmJiBoYXNPd25Qcm9wZXJ0eSh4LCBcInR5cGVcIik7XG59XG5cbmZ1bmN0aW9uIHJhbmRvbUJvdW5kYXJ5KCk6IHN0cmluZyB7XG4gIGxldCBib3VuZGFyeSA9IFwiLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cIjtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCAyNDsgaSsrKSB7XG4gICAgYm91bmRhcnkgKz0gTWF0aC5mbG9vcihNYXRoLnJhbmRvbSgpICogMTYpLnRvU3RyaW5nKDE2KTtcbiAgfVxuICByZXR1cm4gYm91bmRhcnk7XG59XG5cbmNvbnN0IGVuY29kZXIgPSBuZXcgVGV4dEVuY29kZXIoKTtcblxuLyoqXG4gKiBDaGVja3Mgd2hldGhlciBgYnVmYCBzaG91bGQgYmUgY29uc2lkZXJlZCB0byBtYXRjaCB0aGUgYm91bmRhcnkuXG4gKlxuICogVGhlIHByZWZpeCBpcyBcIi0tYm91bmRhcnlcIiBvciBcIlxcclxcbi0tYm91bmRhcnlcIiBvciBcIlxcbi0tYm91bmRhcnlcIiwgYW5kIHRoZVxuICogY2FsbGVyIGhhcyB2ZXJpZmllZCBhbHJlYWR5IHRoYXQgYGhhc1ByZWZpeChidWYsIHByZWZpeClgIGlzIHRydWUuXG4gKlxuICogYG1hdGNoQWZ0ZXJQcmVmaXgoKWAgcmV0dXJucyBgMWAgaWYgdGhlIGJ1ZmZlciBkb2VzIG1hdGNoIHRoZSBib3VuZGFyeSxcbiAqIG1lYW5pbmcgdGhlIHByZWZpeCBpcyBmb2xsb3dlZCBieSBhIGRhc2gsIHNwYWNlLCB0YWIsIGNyLCBubCwgb3IgRU9GLlxuICpcbiAqIEl0IHJldHVybnMgYC0xYCBpZiB0aGUgYnVmZmVyIGRlZmluaXRlbHkgZG9lcyBOT1QgbWF0Y2ggdGhlIGJvdW5kYXJ5LFxuICogbWVhbmluZyB0aGUgcHJlZml4IGlzIGZvbGxvd2VkIGJ5IHNvbWUgb3RoZXIgY2hhcmFjdGVyLlxuICogRm9yIGV4YW1wbGUsIFwiLS1mb29iYXJcIiBkb2VzIG5vdCBtYXRjaCBcIi0tZm9vXCIuXG4gKlxuICogSXQgcmV0dXJucyBgMGAgbW9yZSBpbnB1dCBuZWVkcyB0byBiZSByZWFkIHRvIG1ha2UgdGhlIGRlY2lzaW9uLFxuICogbWVhbmluZyB0aGF0IGBidWYubGVuZ3RoYCBhbmQgYHByZWZpeC5sZW5ndGhgIGFyZSB0aGUgc2FtZS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG1hdGNoQWZ0ZXJQcmVmaXgoXG4gIGJ1ZjogVWludDhBcnJheSxcbiAgcHJlZml4OiBVaW50OEFycmF5LFxuICBlb2Y6IGJvb2xlYW4sXG4pOiAtMSB8IDAgfCAxIHtcbiAgaWYgKGJ1Zi5sZW5ndGggPT09IHByZWZpeC5sZW5ndGgpIHtcbiAgICByZXR1cm4gZW9mID8gMSA6IDA7XG4gIH1cbiAgY29uc3QgYyA9IGJ1ZltwcmVmaXgubGVuZ3RoXTtcbiAgaWYgKFxuICAgIGMgPT09IFwiIFwiLmNoYXJDb2RlQXQoMCkgfHxcbiAgICBjID09PSBcIlxcdFwiLmNoYXJDb2RlQXQoMCkgfHxcbiAgICBjID09PSBcIlxcclwiLmNoYXJDb2RlQXQoMCkgfHxcbiAgICBjID09PSBcIlxcblwiLmNoYXJDb2RlQXQoMCkgfHxcbiAgICBjID09PSBcIi1cIi5jaGFyQ29kZUF0KDApXG4gICkge1xuICAgIHJldHVybiAxO1xuICB9XG4gIHJldHVybiAtMTtcbn1cblxuLyoqXG4gKiBTY2FucyBgYnVmYCB0byBpZGVudGlmeSBob3cgbXVjaCBvZiBpdCBjYW4gYmUgc2FmZWx5IHJldHVybmVkIGFzIHBhcnQgb2YgdGhlXG4gKiBgUGFydFJlYWRlcmAgYm9keS5cbiAqXG4gKiBAcGFyYW0gYnVmIC0gVGhlIGJ1ZmZlciB0byBzZWFyY2ggZm9yIGJvdW5kYXJpZXMuXG4gKiBAcGFyYW0gZGFzaEJvdW5kYXJ5IC0gSXMgXCItLWJvdW5kYXJ5XCIuXG4gKiBAcGFyYW0gbmV3TGluZURhc2hCb3VuZGFyeSAtIElzIFwiXFxyXFxuLS1ib3VuZGFyeVwiIG9yIFwiXFxuLS1ib3VuZGFyeVwiLCBkZXBlbmRpbmdcbiAqIG9uIHdoYXQgbW9kZSB3ZSBhcmUgaW4uIFRoZSBjb21tZW50cyBiZWxvdyAoYW5kIHRoZSBuYW1lKSBhc3N1bWVcbiAqIFwiXFxuLS1ib3VuZGFyeVwiLCBidXQgZWl0aGVyIGlzIGFjY2VwdGVkLlxuICogQHBhcmFtIHRvdGFsIC0gVGhlIG51bWJlciBvZiBieXRlcyByZWFkIG91dCBzbyBmYXIuIElmIHRvdGFsID09IDAsIHRoZW4gYVxuICogbGVhZGluZyBcIi0tYm91bmRhcnlcIiBpcyByZWNvZ25pemVkLlxuICogQHBhcmFtIGVvZiAtIFdoZXRoZXIgYGJ1ZmAgY29udGFpbnMgdGhlIGZpbmFsIGJ5dGVzIGluIHRoZSBzdHJlYW0gYmVmb3JlIEVPRi5cbiAqIElmIGBlb2ZgIGlzIGZhbHNlLCBtb3JlIGJ5dGVzIGFyZSBleHBlY3RlZCB0byBmb2xsb3cuXG4gKiBAcmV0dXJucyBUaGUgbnVtYmVyIG9mIGRhdGEgYnl0ZXMgZnJvbSBidWYgdGhhdCBjYW4gYmUgcmV0dXJuZWQgYXMgcGFydCBvZlxuICogdGhlIGBQYXJ0UmVhZGVyYCBib2R5LlxuICovXG5leHBvcnQgZnVuY3Rpb24gc2NhblVudGlsQm91bmRhcnkoXG4gIGJ1ZjogVWludDhBcnJheSxcbiAgZGFzaEJvdW5kYXJ5OiBVaW50OEFycmF5LFxuICBuZXdMaW5lRGFzaEJvdW5kYXJ5OiBVaW50OEFycmF5LFxuICB0b3RhbDogbnVtYmVyLFxuICBlb2Y6IGJvb2xlYW4sXG4pOiBudW1iZXIgfCBudWxsIHtcbiAgaWYgKHRvdGFsID09PSAwKSB7XG4gICAgLy8gQXQgYmVnaW5uaW5nIG9mIGJvZHksIGFsbG93IGRhc2hCb3VuZGFyeS5cbiAgICBpZiAoc3RhcnRzV2l0aChidWYsIGRhc2hCb3VuZGFyeSkpIHtcbiAgICAgIHN3aXRjaCAobWF0Y2hBZnRlclByZWZpeChidWYsIGRhc2hCb3VuZGFyeSwgZW9mKSkge1xuICAgICAgICBjYXNlIC0xOlxuICAgICAgICAgIHJldHVybiBkYXNoQm91bmRhcnkubGVuZ3RoO1xuICAgICAgICBjYXNlIDA6XG4gICAgICAgICAgcmV0dXJuIDA7XG4gICAgICAgIGNhc2UgMTpcbiAgICAgICAgICByZXR1cm4gbnVsbDtcbiAgICAgIH1cbiAgICB9XG4gICAgaWYgKHN0YXJ0c1dpdGgoZGFzaEJvdW5kYXJ5LCBidWYpKSB7XG4gICAgICByZXR1cm4gMDtcbiAgICB9XG4gIH1cblxuICAvLyBTZWFyY2ggZm9yIFwiXFxuLS1ib3VuZGFyeVwiLlxuICBjb25zdCBpID0gaW5kZXhPZihidWYsIG5ld0xpbmVEYXNoQm91bmRhcnkpO1xuICBpZiAoaSA+PSAwKSB7XG4gICAgc3dpdGNoIChtYXRjaEFmdGVyUHJlZml4KGJ1Zi5zbGljZShpKSwgbmV3TGluZURhc2hCb3VuZGFyeSwgZW9mKSkge1xuICAgICAgY2FzZSAtMTpcbiAgICAgICAgcmV0dXJuIGkgKyBuZXdMaW5lRGFzaEJvdW5kYXJ5Lmxlbmd0aDtcbiAgICAgIGNhc2UgMDpcbiAgICAgICAgcmV0dXJuIGk7XG4gICAgICBjYXNlIDE6XG4gICAgICAgIHJldHVybiBpID4gMCA/IGkgOiBudWxsO1xuICAgIH1cbiAgfVxuICBpZiAoc3RhcnRzV2l0aChuZXdMaW5lRGFzaEJvdW5kYXJ5LCBidWYpKSB7XG4gICAgcmV0dXJuIDA7XG4gIH1cblxuICAvLyBPdGhlcndpc2UsIGFueXRoaW5nIHVwIHRvIHRoZSBmaW5hbCBcXG4gaXMgbm90IHBhcnQgb2YgdGhlIGJvdW5kYXJ5IGFuZCBzb1xuICAvLyBtdXN0IGJlIHBhcnQgb2YgdGhlIGJvZHkuIEFsc28sIGlmIHRoZSBzZWN0aW9uIGZyb20gdGhlIGZpbmFsIFxcbiBvbndhcmQgaXNcbiAgLy8gbm90IGEgcHJlZml4IG9mIHRoZSBib3VuZGFyeSwgaXQgdG9vIG11c3QgYmUgcGFydCBvZiB0aGUgYm9keS5cbiAgY29uc3QgaiA9IGxhc3RJbmRleE9mKGJ1ZiwgbmV3TGluZURhc2hCb3VuZGFyeS5zbGljZSgwLCAxKSk7XG4gIGlmIChqID49IDAgJiYgc3RhcnRzV2l0aChuZXdMaW5lRGFzaEJvdW5kYXJ5LCBidWYuc2xpY2UoaikpKSB7XG4gICAgcmV0dXJuIGo7XG4gIH1cblxuICByZXR1cm4gYnVmLmxlbmd0aDtcbn1cblxuY2xhc3MgUGFydFJlYWRlciBpbXBsZW1lbnRzIERlbm8uUmVhZGVyLCBEZW5vLkNsb3NlciB7XG4gIG46IG51bWJlciB8IG51bGwgPSAwO1xuICB0b3RhbCA9IDA7XG5cbiAgY29uc3RydWN0b3IocHJpdmF0ZSBtcjogTXVsdGlwYXJ0UmVhZGVyLCBwdWJsaWMgcmVhZG9ubHkgaGVhZGVyczogSGVhZGVycykge31cblxuICBhc3luYyByZWFkKHA6IFVpbnQ4QXJyYXkpOiBQcm9taXNlPG51bWJlciB8IG51bGw+IHtcbiAgICBjb25zdCBiciA9IHRoaXMubXIuYnVmUmVhZGVyO1xuXG4gICAgLy8gUmVhZCBpbnRvIGJ1ZmZlciB1bnRpbCB3ZSBpZGVudGlmeSBzb21lIGRhdGEgdG8gcmV0dXJuLFxuICAgIC8vIG9yIHdlIGZpbmQgYSByZWFzb24gdG8gc3RvcCAoYm91bmRhcnkgb3IgRU9GKS5cbiAgICBsZXQgcGVla0xlbmd0aCA9IDE7XG4gICAgd2hpbGUgKHRoaXMubiA9PT0gMCkge1xuICAgICAgcGVla0xlbmd0aCA9IE1hdGgubWF4KHBlZWtMZW5ndGgsIGJyLmJ1ZmZlcmVkKCkpO1xuICAgICAgY29uc3QgcGVla0J1ZiA9IGF3YWl0IGJyLnBlZWsocGVla0xlbmd0aCk7XG4gICAgICBpZiAocGVla0J1ZiA9PT0gbnVsbCkge1xuICAgICAgICB0aHJvdyBuZXcgRGVuby5lcnJvcnMuVW5leHBlY3RlZEVvZigpO1xuICAgICAgfVxuICAgICAgY29uc3QgZW9mID0gcGVla0J1Zi5sZW5ndGggPCBwZWVrTGVuZ3RoO1xuICAgICAgdGhpcy5uID0gc2NhblVudGlsQm91bmRhcnkoXG4gICAgICAgIHBlZWtCdWYsXG4gICAgICAgIHRoaXMubXIuZGFzaEJvdW5kYXJ5LFxuICAgICAgICB0aGlzLm1yLm5ld0xpbmVEYXNoQm91bmRhcnksXG4gICAgICAgIHRoaXMudG90YWwsXG4gICAgICAgIGVvZixcbiAgICAgICk7XG4gICAgICBpZiAodGhpcy5uID09PSAwKSB7XG4gICAgICAgIC8vIEZvcmNlIGJ1ZmZlcmVkIEkvTyB0byByZWFkIG1vcmUgaW50byBidWZmZXIuXG4gICAgICAgIGFzc2VydChlb2YgPT09IGZhbHNlKTtcbiAgICAgICAgcGVla0xlbmd0aCsrO1xuICAgICAgfVxuICAgIH1cblxuICAgIGlmICh0aGlzLm4gPT09IG51bGwpIHtcbiAgICAgIHJldHVybiBudWxsO1xuICAgIH1cblxuICAgIGNvbnN0IG5yZWFkID0gTWF0aC5taW4ocC5sZW5ndGgsIHRoaXMubik7XG4gICAgY29uc3QgYnVmID0gcC5zdWJhcnJheSgwLCBucmVhZCk7XG4gICAgY29uc3QgciA9IGF3YWl0IGJyLnJlYWRGdWxsKGJ1Zik7XG4gICAgYXNzZXJ0KHIgPT09IGJ1Zik7XG4gICAgdGhpcy5uIC09IG5yZWFkO1xuICAgIHRoaXMudG90YWwgKz0gbnJlYWQ7XG4gICAgcmV0dXJuIG5yZWFkO1xuICB9XG5cbiAgY2xvc2UoKTogdm9pZCB7fVxuXG4gIHByaXZhdGUgY29udGVudERpc3Bvc2l0aW9uITogc3RyaW5nO1xuICBwcml2YXRlIGNvbnRlbnREaXNwb3NpdGlvblBhcmFtcyE6IHsgW2tleTogc3RyaW5nXTogc3RyaW5nIH07XG5cbiAgcHJpdmF0ZSBnZXRDb250ZW50RGlzcG9zaXRpb25QYXJhbXMoKTogeyBba2V5OiBzdHJpbmddOiBzdHJpbmcgfSB7XG4gICAgaWYgKHRoaXMuY29udGVudERpc3Bvc2l0aW9uUGFyYW1zKSByZXR1cm4gdGhpcy5jb250ZW50RGlzcG9zaXRpb25QYXJhbXM7XG4gICAgY29uc3QgY2QgPSB0aGlzLmhlYWRlcnMuZ2V0KFwiY29udGVudC1kaXNwb3NpdGlvblwiKTtcbiAgICBjb25zdCBwYXJhbXM6IHsgW2tleTogc3RyaW5nXTogc3RyaW5nIH0gPSB7fTtcbiAgICBhc3NlcnQoY2QgIT0gbnVsbCwgXCJjb250ZW50LWRpc3Bvc2l0aW9uIG11c3QgYmUgc2V0XCIpO1xuICAgIGNvbnN0IGNvbXBzID0gZGVjb2RlVVJJKGNkKS5zcGxpdChcIjtcIik7XG4gICAgdGhpcy5jb250ZW50RGlzcG9zaXRpb24gPSBjb21wc1swXTtcbiAgICBjb21wc1xuICAgICAgLnNsaWNlKDEpXG4gICAgICAubWFwKCh2OiBzdHJpbmcpOiBzdHJpbmcgPT4gdi50cmltKCkpXG4gICAgICAubWFwKChrdjogc3RyaW5nKTogdm9pZCA9PiB7XG4gICAgICAgIGNvbnN0IFtrLCB2XSA9IGt2LnNwbGl0KFwiPVwiKTtcbiAgICAgICAgaWYgKHYpIHtcbiAgICAgICAgICBjb25zdCBzID0gdi5jaGFyQXQoMCk7XG4gICAgICAgICAgY29uc3QgZSA9IHYuY2hhckF0KHYubGVuZ3RoIC0gMSk7XG4gICAgICAgICAgaWYgKChzID09PSBlICYmIHMgPT09ICdcIicpIHx8IHMgPT09IFwiJ1wiKSB7XG4gICAgICAgICAgICBwYXJhbXNba10gPSB2LnN1YnN0cigxLCB2Lmxlbmd0aCAtIDIpO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBwYXJhbXNba10gPSB2O1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgcmV0dXJuICh0aGlzLmNvbnRlbnREaXNwb3NpdGlvblBhcmFtcyA9IHBhcmFtcyk7XG4gIH1cblxuICBnZXQgZmlsZU5hbWUoKTogc3RyaW5nIHtcbiAgICByZXR1cm4gdGhpcy5nZXRDb250ZW50RGlzcG9zaXRpb25QYXJhbXMoKVtcImZpbGVuYW1lXCJdO1xuICB9XG5cbiAgZ2V0IGZvcm1OYW1lKCk6IHN0cmluZyB7XG4gICAgY29uc3QgcCA9IHRoaXMuZ2V0Q29udGVudERpc3Bvc2l0aW9uUGFyYW1zKCk7XG4gICAgaWYgKHRoaXMuY29udGVudERpc3Bvc2l0aW9uID09PSBcImZvcm0tZGF0YVwiKSB7XG4gICAgICByZXR1cm4gcFtcIm5hbWVcIl07XG4gICAgfVxuICAgIHJldHVybiBcIlwiO1xuICB9XG59XG5cbmZ1bmN0aW9uIHNraXBMV1NQQ2hhcih1OiBVaW50OEFycmF5KTogVWludDhBcnJheSB7XG4gIGNvbnN0IHJldCA9IG5ldyBVaW50OEFycmF5KHUubGVuZ3RoKTtcbiAgY29uc3Qgc3AgPSBcIiBcIi5jaGFyQ29kZUF0KDApO1xuICBjb25zdCBodCA9IFwiXFx0XCIuY2hhckNvZGVBdCgwKTtcbiAgbGV0IGogPSAwO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IHUubGVuZ3RoOyBpKyspIHtcbiAgICBpZiAodVtpXSA9PT0gc3AgfHwgdVtpXSA9PT0gaHQpIGNvbnRpbnVlO1xuICAgIHJldFtqKytdID0gdVtpXTtcbiAgfVxuICByZXR1cm4gcmV0LnNsaWNlKDAsIGopO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIE11bHRpcGFydEZvcm1EYXRhIHtcbiAgZmlsZShrZXk6IHN0cmluZyk6IEZvcm1GaWxlIHwgRm9ybUZpbGVbXSB8IHVuZGVmaW5lZDtcbiAgdmFsdWUoa2V5OiBzdHJpbmcpOiBzdHJpbmcgfCB1bmRlZmluZWQ7XG4gIGVudHJpZXMoKTogSXRlcmFibGVJdGVyYXRvcjxcbiAgICBbc3RyaW5nLCBzdHJpbmcgfCBGb3JtRmlsZSB8IEZvcm1GaWxlW10gfCB1bmRlZmluZWRdXG4gID47XG4gIFtTeW1ib2wuaXRlcmF0b3JdKCk6IEl0ZXJhYmxlSXRlcmF0b3I8XG4gICAgW3N0cmluZywgc3RyaW5nIHwgRm9ybUZpbGUgfCBGb3JtRmlsZVtdIHwgdW5kZWZpbmVkXVxuICA+O1xuICAvKiogUmVtb3ZlIGFsbCB0ZW1wZmlsZXMgKi9cbiAgcmVtb3ZlQWxsKCk6IFByb21pc2U8dm9pZD47XG59XG5cbi8qKlxuICogb3B0aW9ucyBmb3IgcmVhZGluZyBmb3Jtcy5cbiAqIEBwcm9wZXJ0eSBtYXhNZW1vcnkgLSBtYXhpbXVtIG1lbW9yeSBzaXplIHRvIHN0b3JlIGZpbGUgaW4gbWVtb3J5LiBieXRlcy5cbiAqIEBkZWZhdWx0IDEwNDg1NzYwICgxME1CKVxuICogQHByb3BlcnR5IGRpciAtIGRpcmVjdG9yeSB3aGVyZSBmaWxlcyB0aGF0IGRvbid0IGZpdCBpbnRvIG1heE1lbW9yeSB3aWxsIGJlXG4gKiBzdG9yZWQuXG4gKiBAcHJvcGVydHkgcHJlZml4IC0gYSBwcmVmaXggdGhhdCB3aWxsIGJlIHVzZWQgZm9yIGFsbCBmaWxlcyBjcmVhdGVkIGlmXG4gKiBtYXhNZW1vcnkgaXMgZXhjZWVkZWQuXG4gKiBAcHJvcGVydHkgc3VmZml4IC0gYSBzdWZmaXggdGhhdCB3aWxsIGJlIHVzZWQgZm9yIGFsbCBmaWxlcyBjcmVhdGVkIGlmXG4gKiBtYXhNZW1vcnkgaXMgZXhjZWVkZWQsIGRlZmF1bHRzIHRvIHRoZSBmb2xlIGV4dGVuc2lvblxuICovXG5leHBvcnQgaW50ZXJmYWNlIFJlYWRGb3JtT3B0aW9ucyB7XG4gIG1heE1lbW9yeT86IG51bWJlcjtcbiAgZGlyPzogc3RyaW5nO1xuICBwcmVmaXg/OiBzdHJpbmc7XG4gIHN1ZmZpeD86IHN0cmluZztcbn1cblxuLyoqIFJlYWRlciBmb3IgcGFyc2luZyBtdWx0aXBhcnQvZm9ybS1kYXRhICovXG5leHBvcnQgY2xhc3MgTXVsdGlwYXJ0UmVhZGVyIHtcbiAgcmVhZG9ubHkgbmV3TGluZTogVWludDhBcnJheTtcbiAgcmVhZG9ubHkgbmV3TGluZURhc2hCb3VuZGFyeTogVWludDhBcnJheTtcbiAgcmVhZG9ubHkgZGFzaEJvdW5kYXJ5RGFzaDogVWludDhBcnJheTtcbiAgcmVhZG9ubHkgZGFzaEJvdW5kYXJ5OiBVaW50OEFycmF5O1xuICByZWFkb25seSBidWZSZWFkZXI6IEJ1ZlJlYWRlcjtcblxuICBjb25zdHJ1Y3RvcihyZWFkZXI6IERlbm8uUmVhZGVyLCBwcml2YXRlIGJvdW5kYXJ5OiBzdHJpbmcpIHtcbiAgICB0aGlzLm5ld0xpbmUgPSBlbmNvZGVyLmVuY29kZShcIlxcclxcblwiKTtcbiAgICB0aGlzLm5ld0xpbmVEYXNoQm91bmRhcnkgPSBlbmNvZGVyLmVuY29kZShgXFxyXFxuLS0ke2JvdW5kYXJ5fWApO1xuICAgIHRoaXMuZGFzaEJvdW5kYXJ5RGFzaCA9IGVuY29kZXIuZW5jb2RlKGAtLSR7dGhpcy5ib3VuZGFyeX0tLWApO1xuICAgIHRoaXMuZGFzaEJvdW5kYXJ5ID0gZW5jb2Rlci5lbmNvZGUoYC0tJHt0aGlzLmJvdW5kYXJ5fWApO1xuICAgIHRoaXMuYnVmUmVhZGVyID0gbmV3IEJ1ZlJlYWRlcihyZWFkZXIpO1xuICB9XG5cbiAgLyoqIFJlYWQgYWxsIGZvcm0gZGF0YSBmcm9tIHN0cmVhbS5cbiAgICogSWYgdG90YWwgc2l6ZSBvZiBzdG9yZWQgZGF0YSBpbiBtZW1vcnkgZXhjZWVkIG1heE1lbW9yeSxcbiAgICogb3ZlcmZsb3dlZCBmaWxlIGRhdGEgd2lsbCBiZSB3cml0dGVuIHRvIHRlbXBvcmFsIGZpbGVzLlxuICAgKiBTdHJpbmcgZmllbGQgdmFsdWVzIGFyZSBuZXZlciB3cml0dGVuIHRvIGZpbGVzLlxuICAgKiBudWxsIHZhbHVlIG1lYW5zIHBhcnNpbmcgb3Igd3JpdGluZyB0byBmaWxlIHdhcyBmYWlsZWQgaW4gc29tZSByZWFzb24uXG4gICAqIEBwYXJhbSBtYXhNZW1vcnkgbWF4aW11bSBtZW1vcnkgc2l6ZSB0byBzdG9yZSBmaWxlIGluIG1lbW9yeS4gYnl0ZXMuIEBkZWZhdWx0IDEwNDg1NzYwICgxME1CKVxuICAgKiAgKi9cbiAgYXN5bmMgcmVhZEZvcm0obWF4TWVtb3J5PzogbnVtYmVyKTogUHJvbWlzZTxNdWx0aXBhcnRGb3JtRGF0YT47XG4gIC8qKiBSZWFkIGFsbCBmb3JtIGRhdGEgZnJvbSBzdHJlYW0uXG4gICAqIElmIHRvdGFsIHNpemUgb2Ygc3RvcmVkIGRhdGEgaW4gbWVtb3J5IGV4Y2VlZCBvcHRpb25zLm1heE1lbW9yeSxcbiAgICogb3ZlcmZsb3dlZCBmaWxlIGRhdGEgd2lsbCBiZSB3cml0dGVuIHRvIHRlbXBvcmFsIGZpbGVzLlxuICAgKiBTdHJpbmcgZmllbGQgdmFsdWVzIGFyZSBuZXZlciB3cml0dGVuIHRvIGZpbGVzLlxuICAgKiBudWxsIHZhbHVlIG1lYW5zIHBhcnNpbmcgb3Igd3JpdGluZyB0byBmaWxlIHdhcyBmYWlsZWQgaW4gc29tZSByZWFzb24uXG4gICAqIEBwYXJhbSBvcHRpb25zIG9wdGlvbnMgdG8gY29uZmlndXJlIHRoZSBiZWhhdmlvciBvZiBzdG9yaW5nXG4gICAqIG92ZXJmbG93IGZpbGUgZGF0YSBpbiB0ZW1wb3JhbCBmaWxlcy5cbiAgICogICovXG4gIGFzeW5jIHJlYWRGb3JtKG9wdGlvbnM/OiBSZWFkRm9ybU9wdGlvbnMpOiBQcm9taXNlPE11bHRpcGFydEZvcm1EYXRhPjtcbiAgYXN5bmMgcmVhZEZvcm0oXG4gICAgbWF4TWVtb3J5T3JPcHRpb25zPzogbnVtYmVyIHwgUmVhZEZvcm1PcHRpb25zLFxuICApOiBQcm9taXNlPE11bHRpcGFydEZvcm1EYXRhPiB7XG4gICAgY29uc3Qgb3B0aW9ucyA9IHR5cGVvZiBtYXhNZW1vcnlPck9wdGlvbnMgPT09IFwibnVtYmVyXCJcbiAgICAgID8geyBtYXhNZW1vcnk6IG1heE1lbW9yeU9yT3B0aW9ucyB9XG4gICAgICA6IG1heE1lbW9yeU9yT3B0aW9ucztcbiAgICBsZXQgbWF4TWVtb3J5ID0gb3B0aW9ucz8ubWF4TWVtb3J5ID8/IDEwIDw8IDIwO1xuICAgIGNvbnN0IGZpbGVNYXAgPSBuZXcgTWFwPHN0cmluZywgRm9ybUZpbGUgfCBGb3JtRmlsZVtdPigpO1xuICAgIGNvbnN0IHZhbHVlTWFwID0gbmV3IE1hcDxzdHJpbmcsIHN0cmluZz4oKTtcbiAgICBsZXQgbWF4VmFsdWVCeXRlcyA9IG1heE1lbW9yeSArICgxMCA8PCAyMCk7XG4gICAgY29uc3QgYnVmID0gbmV3IEJ1ZmZlcihuZXcgVWludDhBcnJheShtYXhWYWx1ZUJ5dGVzKSk7XG4gICAgZm9yICg7Oykge1xuICAgICAgY29uc3QgcCA9IGF3YWl0IHRoaXMubmV4dFBhcnQoKTtcbiAgICAgIGlmIChwID09PSBudWxsKSB7XG4gICAgICAgIGJyZWFrO1xuICAgICAgfVxuICAgICAgaWYgKHAuZm9ybU5hbWUgPT09IFwiXCIpIHtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBidWYucmVzZXQoKTtcbiAgICAgIGlmICghcC5maWxlTmFtZSkge1xuICAgICAgICAvLyB2YWx1ZVxuICAgICAgICBjb25zdCBuID0gYXdhaXQgY29weU4ocCwgYnVmLCBtYXhWYWx1ZUJ5dGVzKTtcbiAgICAgICAgbWF4VmFsdWVCeXRlcyAtPSBuO1xuICAgICAgICBpZiAobWF4VmFsdWVCeXRlcyA8IDApIHtcbiAgICAgICAgICB0aHJvdyBuZXcgUmFuZ2VFcnJvcihcIm1lc3NhZ2UgdG9vIGxhcmdlXCIpO1xuICAgICAgICB9XG4gICAgICAgIGNvbnN0IHZhbHVlID0gbmV3IFRleHREZWNvZGVyKCkuZGVjb2RlKGJ1Zi5ieXRlcygpKTtcbiAgICAgICAgdmFsdWVNYXAuc2V0KHAuZm9ybU5hbWUsIHZhbHVlKTtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICAvLyBmaWxlXG4gICAgICBsZXQgZm9ybUZpbGU6IEZvcm1GaWxlIHwgRm9ybUZpbGVbXSB8IHVuZGVmaW5lZDtcbiAgICAgIGNvbnN0IG4gPSBhd2FpdCBjb3B5TihwLCBidWYsIG1heFZhbHVlQnl0ZXMpO1xuICAgICAgY29uc3QgY29udGVudFR5cGUgPSBwLmhlYWRlcnMuZ2V0KFwiY29udGVudC10eXBlXCIpO1xuICAgICAgYXNzZXJ0KGNvbnRlbnRUeXBlICE9IG51bGwsIFwiY29udGVudC10eXBlIG11c3QgYmUgc2V0XCIpO1xuICAgICAgaWYgKG4gPiBtYXhNZW1vcnkpIHtcbiAgICAgICAgLy8gdG9vIGJpZywgd3JpdGUgdG8gZGlzayBhbmQgZmx1c2ggYnVmZmVyXG4gICAgICAgIGNvbnN0IGV4dCA9IGV4dG5hbWUocC5maWxlTmFtZSk7XG4gICAgICAgIGNvbnN0IGZpbGVwYXRoID0gYXdhaXQgRGVuby5tYWtlVGVtcEZpbGUoe1xuICAgICAgICAgIGRpcjogb3B0aW9ucz8uZGlyID8/IFwiLlwiLFxuICAgICAgICAgIHByZWZpeDogb3B0aW9ucz8ucHJlZml4ID8/IFwibXVsdGlwYXJ0LVwiLFxuICAgICAgICAgIHN1ZmZpeDogb3B0aW9ucz8uc3VmZml4ID8/IGV4dCxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgY29uc3QgZmlsZSA9IGF3YWl0IERlbm8ub3BlbihmaWxlcGF0aCwgeyB3cml0ZTogdHJ1ZSB9KTtcblxuICAgICAgICB0cnkge1xuICAgICAgICAgIGNvbnN0IHNpemUgPSBhd2FpdCBEZW5vLmNvcHkobmV3IE11bHRpUmVhZGVyKGJ1ZiwgcCksIGZpbGUpO1xuXG4gICAgICAgICAgZmlsZS5jbG9zZSgpO1xuICAgICAgICAgIGZvcm1GaWxlID0ge1xuICAgICAgICAgICAgZmlsZW5hbWU6IHAuZmlsZU5hbWUsXG4gICAgICAgICAgICB0eXBlOiBjb250ZW50VHlwZSxcbiAgICAgICAgICAgIHRlbXBmaWxlOiBmaWxlcGF0aCxcbiAgICAgICAgICAgIHNpemUsXG4gICAgICAgICAgfTtcbiAgICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAgIGF3YWl0IERlbm8ucmVtb3ZlKGZpbGVwYXRoKTtcbiAgICAgICAgICB0aHJvdyBlO1xuICAgICAgICB9XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBmb3JtRmlsZSA9IHtcbiAgICAgICAgICBmaWxlbmFtZTogcC5maWxlTmFtZSxcbiAgICAgICAgICB0eXBlOiBjb250ZW50VHlwZSxcbiAgICAgICAgICBjb250ZW50OiBidWYuYnl0ZXMoKSxcbiAgICAgICAgICBzaXplOiBidWYubGVuZ3RoLFxuICAgICAgICB9O1xuICAgICAgICBtYXhNZW1vcnkgLT0gbjtcbiAgICAgICAgbWF4VmFsdWVCeXRlcyAtPSBuO1xuICAgICAgfVxuICAgICAgaWYgKGZvcm1GaWxlKSB7XG4gICAgICAgIGNvbnN0IG1hcFZhbCA9IGZpbGVNYXAuZ2V0KHAuZm9ybU5hbWUpO1xuICAgICAgICBpZiAobWFwVmFsICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICBpZiAoQXJyYXkuaXNBcnJheShtYXBWYWwpKSB7XG4gICAgICAgICAgICBtYXBWYWwucHVzaChmb3JtRmlsZSk7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGZpbGVNYXAuc2V0KHAuZm9ybU5hbWUsIFttYXBWYWwsIGZvcm1GaWxlXSk7XG4gICAgICAgICAgfVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGZpbGVNYXAuc2V0KHAuZm9ybU5hbWUsIGZvcm1GaWxlKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gbXVsdGlwYXJ0Rm9ybURhdGEoZmlsZU1hcCwgdmFsdWVNYXApO1xuICB9XG5cbiAgcHJpdmF0ZSBjdXJyZW50UGFydDogUGFydFJlYWRlciB8IHVuZGVmaW5lZDtcbiAgcHJpdmF0ZSBwYXJ0c1JlYWQgPSAwO1xuXG4gIHByaXZhdGUgYXN5bmMgbmV4dFBhcnQoKTogUHJvbWlzZTxQYXJ0UmVhZGVyIHwgbnVsbD4ge1xuICAgIGlmICh0aGlzLmN1cnJlbnRQYXJ0KSB7XG4gICAgICB0aGlzLmN1cnJlbnRQYXJ0LmNsb3NlKCk7XG4gICAgfVxuICAgIGlmIChlcXVhbHModGhpcy5kYXNoQm91bmRhcnksIGVuY29kZXIuZW5jb2RlKFwiLS1cIikpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJib3VuZGFyeSBpcyBlbXB0eVwiKTtcbiAgICB9XG4gICAgbGV0IGV4cGVjdE5ld1BhcnQgPSBmYWxzZTtcbiAgICBmb3IgKDs7KSB7XG4gICAgICBjb25zdCBsaW5lID0gYXdhaXQgdGhpcy5idWZSZWFkZXIucmVhZFNsaWNlKFwiXFxuXCIuY2hhckNvZGVBdCgwKSk7XG4gICAgICBpZiAobGluZSA9PT0gbnVsbCkge1xuICAgICAgICB0aHJvdyBuZXcgRGVuby5lcnJvcnMuVW5leHBlY3RlZEVvZigpO1xuICAgICAgfVxuICAgICAgaWYgKHRoaXMuaXNCb3VuZGFyeURlbGltaXRlckxpbmUobGluZSkpIHtcbiAgICAgICAgdGhpcy5wYXJ0c1JlYWQrKztcbiAgICAgICAgY29uc3QgciA9IG5ldyBUZXh0UHJvdG9SZWFkZXIodGhpcy5idWZSZWFkZXIpO1xuICAgICAgICBjb25zdCBoZWFkZXJzID0gYXdhaXQgci5yZWFkTUlNRUhlYWRlcigpO1xuICAgICAgICBpZiAoaGVhZGVycyA9PT0gbnVsbCkge1xuICAgICAgICAgIHRocm93IG5ldyBEZW5vLmVycm9ycy5VbmV4cGVjdGVkRW9mKCk7XG4gICAgICAgIH1cbiAgICAgICAgY29uc3QgbnAgPSBuZXcgUGFydFJlYWRlcih0aGlzLCBoZWFkZXJzKTtcbiAgICAgICAgdGhpcy5jdXJyZW50UGFydCA9IG5wO1xuICAgICAgICByZXR1cm4gbnA7XG4gICAgICB9XG4gICAgICBpZiAodGhpcy5pc0ZpbmFsQm91bmRhcnkobGluZSkpIHtcbiAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgICB9XG4gICAgICBpZiAoZXhwZWN0TmV3UGFydCkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYGV4cGVjdGluZyBhIG5ldyBQYXJ0OyBnb3QgbGluZSAke2xpbmV9YCk7XG4gICAgICB9XG4gICAgICBpZiAodGhpcy5wYXJ0c1JlYWQgPT09IDApIHtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBpZiAoZXF1YWxzKGxpbmUsIHRoaXMubmV3TGluZSkpIHtcbiAgICAgICAgZXhwZWN0TmV3UGFydCA9IHRydWU7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgdGhyb3cgbmV3IEVycm9yKGB1bmV4cGVjdGVkIGxpbmUgaW4gbmV4dFBhcnQoKTogJHtsaW5lfWApO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgaXNGaW5hbEJvdW5kYXJ5KGxpbmU6IFVpbnQ4QXJyYXkpOiBib29sZWFuIHtcbiAgICBpZiAoIXN0YXJ0c1dpdGgobGluZSwgdGhpcy5kYXNoQm91bmRhcnlEYXNoKSkge1xuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cbiAgICBjb25zdCByZXN0ID0gbGluZS5zbGljZSh0aGlzLmRhc2hCb3VuZGFyeURhc2gubGVuZ3RoLCBsaW5lLmxlbmd0aCk7XG4gICAgcmV0dXJuIHJlc3QubGVuZ3RoID09PSAwIHx8IGVxdWFscyhza2lwTFdTUENoYXIocmVzdCksIHRoaXMubmV3TGluZSk7XG4gIH1cblxuICBwcml2YXRlIGlzQm91bmRhcnlEZWxpbWl0ZXJMaW5lKGxpbmU6IFVpbnQ4QXJyYXkpOiBib29sZWFuIHtcbiAgICBpZiAoIXN0YXJ0c1dpdGgobGluZSwgdGhpcy5kYXNoQm91bmRhcnkpKSB7XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuICAgIGNvbnN0IHJlc3QgPSBsaW5lLnNsaWNlKHRoaXMuZGFzaEJvdW5kYXJ5Lmxlbmd0aCk7XG4gICAgcmV0dXJuIGVxdWFscyhza2lwTFdTUENoYXIocmVzdCksIHRoaXMubmV3TGluZSk7XG4gIH1cbn1cblxuZnVuY3Rpb24gbXVsdGlwYXJ0Rm9ybURhdGEoXG4gIGZpbGVNYXA6IE1hcDxzdHJpbmcsIEZvcm1GaWxlIHwgRm9ybUZpbGVbXT4sXG4gIHZhbHVlTWFwOiBNYXA8c3RyaW5nLCBzdHJpbmc+LFxuKTogTXVsdGlwYXJ0Rm9ybURhdGEge1xuICBmdW5jdGlvbiBmaWxlKGtleTogc3RyaW5nKTogRm9ybUZpbGUgfCBGb3JtRmlsZVtdIHwgdW5kZWZpbmVkIHtcbiAgICByZXR1cm4gZmlsZU1hcC5nZXQoa2V5KTtcbiAgfVxuICBmdW5jdGlvbiB2YWx1ZShrZXk6IHN0cmluZyk6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gICAgcmV0dXJuIHZhbHVlTWFwLmdldChrZXkpO1xuICB9XG4gIGZ1bmN0aW9uKiBlbnRyaWVzKCk6IEl0ZXJhYmxlSXRlcmF0b3I8XG4gICAgW3N0cmluZywgc3RyaW5nIHwgRm9ybUZpbGUgfCBGb3JtRmlsZVtdIHwgdW5kZWZpbmVkXVxuICA+IHtcbiAgICB5aWVsZCogZmlsZU1hcDtcbiAgICB5aWVsZCogdmFsdWVNYXA7XG4gIH1cbiAgYXN5bmMgZnVuY3Rpb24gcmVtb3ZlQWxsKCkge1xuICAgIGNvbnN0IHByb21pc2VzOiBBcnJheTxQcm9taXNlPHZvaWQ+PiA9IFtdO1xuICAgIGZvciAoY29uc3QgdmFsIG9mIGZpbGVNYXAudmFsdWVzKCkpIHtcbiAgICAgIGlmIChBcnJheS5pc0FycmF5KHZhbCkpIHtcbiAgICAgICAgZm9yIChjb25zdCBzdWJWYWwgb2YgdmFsKSB7XG4gICAgICAgICAgaWYgKCFzdWJWYWwudGVtcGZpbGUpIGNvbnRpbnVlO1xuICAgICAgICAgIHByb21pc2VzLnB1c2goRGVuby5yZW1vdmUoc3ViVmFsLnRlbXBmaWxlKSk7XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGlmICghdmFsLnRlbXBmaWxlKSBjb250aW51ZTtcbiAgICAgICAgcHJvbWlzZXMucHVzaChEZW5vLnJlbW92ZSh2YWwudGVtcGZpbGUpKTtcbiAgICAgIH1cbiAgICB9XG4gICAgYXdhaXQgUHJvbWlzZS5hbGwocHJvbWlzZXMpO1xuICB9XG4gIHJldHVybiB7XG4gICAgZmlsZSxcbiAgICB2YWx1ZSxcbiAgICBlbnRyaWVzLFxuICAgIHJlbW92ZUFsbCxcbiAgICBbU3ltYm9sLml0ZXJhdG9yXSgpOiBJdGVyYWJsZUl0ZXJhdG9yPFxuICAgICAgW3N0cmluZywgc3RyaW5nIHwgRm9ybUZpbGUgfCBGb3JtRmlsZVtdIHwgdW5kZWZpbmVkXVxuICAgID4ge1xuICAgICAgcmV0dXJuIGVudHJpZXMoKTtcbiAgICB9LFxuICB9O1xufVxuXG5jbGFzcyBQYXJ0V3JpdGVyIGltcGxlbWVudHMgRGVuby5Xcml0ZXIge1xuICBjbG9zZWQgPSBmYWxzZTtcbiAgcHJpdmF0ZSByZWFkb25seSBwYXJ0SGVhZGVyOiBzdHJpbmc7XG4gIHByaXZhdGUgaGVhZGVyc1dyaXR0ZW4gPSBmYWxzZTtcblxuICBjb25zdHJ1Y3RvcihcbiAgICBwcml2YXRlIHdyaXRlcjogRGVuby5Xcml0ZXIsXG4gICAgcmVhZG9ubHkgYm91bmRhcnk6IHN0cmluZyxcbiAgICBwdWJsaWMgaGVhZGVyczogSGVhZGVycyxcbiAgICBpc0ZpcnN0Qm91bmRhcnk6IGJvb2xlYW4sXG4gICkge1xuICAgIGxldCBidWYgPSBcIlwiO1xuICAgIGlmIChpc0ZpcnN0Qm91bmRhcnkpIHtcbiAgICAgIGJ1ZiArPSBgLS0ke2JvdW5kYXJ5fVxcclxcbmA7XG4gICAgfSBlbHNlIHtcbiAgICAgIGJ1ZiArPSBgXFxyXFxuLS0ke2JvdW5kYXJ5fVxcclxcbmA7XG4gICAgfVxuICAgIGZvciAoY29uc3QgW2tleSwgdmFsdWVdIG9mIGhlYWRlcnMuZW50cmllcygpKSB7XG4gICAgICBidWYgKz0gYCR7a2V5fTogJHt2YWx1ZX1cXHJcXG5gO1xuICAgIH1cbiAgICBidWYgKz0gYFxcclxcbmA7XG4gICAgdGhpcy5wYXJ0SGVhZGVyID0gYnVmO1xuICB9XG5cbiAgY2xvc2UoKTogdm9pZCB7XG4gICAgdGhpcy5jbG9zZWQgPSB0cnVlO1xuICB9XG5cbiAgYXN5bmMgd3JpdGUocDogVWludDhBcnJheSk6IFByb21pc2U8bnVtYmVyPiB7XG4gICAgaWYgKHRoaXMuY2xvc2VkKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJwYXJ0IGlzIGNsb3NlZFwiKTtcbiAgICB9XG4gICAgaWYgKCF0aGlzLmhlYWRlcnNXcml0dGVuKSB7XG4gICAgICBhd2FpdCB0aGlzLndyaXRlci53cml0ZShlbmNvZGVyLmVuY29kZSh0aGlzLnBhcnRIZWFkZXIpKTtcbiAgICAgIHRoaXMuaGVhZGVyc1dyaXR0ZW4gPSB0cnVlO1xuICAgIH1cbiAgICByZXR1cm4gdGhpcy53cml0ZXIud3JpdGUocCk7XG4gIH1cbn1cblxuZnVuY3Rpb24gY2hlY2tCb3VuZGFyeShiOiBzdHJpbmcpOiBzdHJpbmcge1xuICBpZiAoYi5sZW5ndGggPCAxIHx8IGIubGVuZ3RoID4gNzApIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYGludmFsaWQgYm91bmRhcnkgbGVuZ3RoOiAke2IubGVuZ3RofWApO1xuICB9XG4gIGNvbnN0IGVuZCA9IGIubGVuZ3RoIC0gMTtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBlbmQ7IGkrKykge1xuICAgIGNvbnN0IGMgPSBiLmNoYXJBdChpKTtcbiAgICBpZiAoIWMubWF0Y2goL1thLXpBLVowLTknKCkrXyxcXC0uLzo9P10vKSB8fCAoYyA9PT0gXCIgXCIgJiYgaSAhPT0gZW5kKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiaW52YWxpZCBib3VuZGFyeSBjaGFyYWN0ZXI6IFwiICsgYyk7XG4gICAgfVxuICB9XG4gIHJldHVybiBiO1xufVxuXG4vKiogV3JpdGVyIGZvciBjcmVhdGluZyBtdWx0aXBhcnQvZm9ybS1kYXRhICovXG5leHBvcnQgY2xhc3MgTXVsdGlwYXJ0V3JpdGVyIHtcbiAgcHJpdmF0ZSByZWFkb25seSBfYm91bmRhcnk6IHN0cmluZztcblxuICBnZXQgYm91bmRhcnkoKTogc3RyaW5nIHtcbiAgICByZXR1cm4gdGhpcy5fYm91bmRhcnk7XG4gIH1cblxuICBwcml2YXRlIGxhc3RQYXJ0OiBQYXJ0V3JpdGVyIHwgdW5kZWZpbmVkO1xuICBwcml2YXRlIGJ1ZldyaXRlcjogQnVmV3JpdGVyO1xuICBwcml2YXRlIGlzQ2xvc2VkID0gZmFsc2U7XG5cbiAgY29uc3RydWN0b3IocHJpdmF0ZSByZWFkb25seSB3cml0ZXI6IERlbm8uV3JpdGVyLCBib3VuZGFyeT86IHN0cmluZykge1xuICAgIGlmIChib3VuZGFyeSAhPT0gdm9pZCAwKSB7XG4gICAgICB0aGlzLl9ib3VuZGFyeSA9IGNoZWNrQm91bmRhcnkoYm91bmRhcnkpO1xuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLl9ib3VuZGFyeSA9IHJhbmRvbUJvdW5kYXJ5KCk7XG4gICAgfVxuICAgIHRoaXMuYnVmV3JpdGVyID0gbmV3IEJ1ZldyaXRlcih3cml0ZXIpO1xuICB9XG5cbiAgZm9ybURhdGFDb250ZW50VHlwZSgpOiBzdHJpbmcge1xuICAgIHJldHVybiBgbXVsdGlwYXJ0L2Zvcm0tZGF0YTsgYm91bmRhcnk9JHt0aGlzLmJvdW5kYXJ5fWA7XG4gIH1cblxuICBjcmVhdGVQYXJ0KGhlYWRlcnM6IEhlYWRlcnMpOiBEZW5vLldyaXRlciB7XG4gICAgaWYgKHRoaXMuaXNDbG9zZWQpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIm11bHRpcGFydDogd3JpdGVyIGlzIGNsb3NlZFwiKTtcbiAgICB9XG4gICAgaWYgKHRoaXMubGFzdFBhcnQpIHtcbiAgICAgIHRoaXMubGFzdFBhcnQuY2xvc2UoKTtcbiAgICB9XG4gICAgY29uc3QgcGFydCA9IG5ldyBQYXJ0V3JpdGVyKFxuICAgICAgdGhpcy53cml0ZXIsXG4gICAgICB0aGlzLmJvdW5kYXJ5LFxuICAgICAgaGVhZGVycyxcbiAgICAgICF0aGlzLmxhc3RQYXJ0LFxuICAgICk7XG4gICAgdGhpcy5sYXN0UGFydCA9IHBhcnQ7XG4gICAgcmV0dXJuIHBhcnQ7XG4gIH1cblxuICBjcmVhdGVGb3JtRmlsZShcbiAgICBmaWVsZDogc3RyaW5nLFxuICAgIGZpbGVuYW1lOiBzdHJpbmcsXG4gICk6IERlbm8uV3JpdGVyIHtcbiAgICBjb25zdCBoID0gbmV3IEhlYWRlcnMoKTtcbiAgICBoLnNldChcbiAgICAgIFwiQ29udGVudC1EaXNwb3NpdGlvblwiLFxuICAgICAgYGZvcm0tZGF0YTsgbmFtZT1cIiR7ZmllbGR9XCI7IGZpbGVuYW1lPVwiJHtmaWxlbmFtZX1cImAsXG4gICAgKTtcbiAgICBoLnNldChcIkNvbnRlbnQtVHlwZVwiLCBcImFwcGxpY2F0aW9uL29jdGV0LXN0cmVhbVwiKTtcbiAgICByZXR1cm4gdGhpcy5jcmVhdGVQYXJ0KGgpO1xuICB9XG5cbiAgY3JlYXRlRm9ybUZpZWxkKGZpZWxkOiBzdHJpbmcpOiBEZW5vLldyaXRlciB7XG4gICAgY29uc3QgaCA9IG5ldyBIZWFkZXJzKCk7XG4gICAgaC5zZXQoXCJDb250ZW50LURpc3Bvc2l0aW9uXCIsIGBmb3JtLWRhdGE7IG5hbWU9XCIke2ZpZWxkfVwiYCk7XG4gICAgaC5zZXQoXCJDb250ZW50LVR5cGVcIiwgXCJhcHBsaWNhdGlvbi9vY3RldC1zdHJlYW1cIik7XG4gICAgcmV0dXJuIHRoaXMuY3JlYXRlUGFydChoKTtcbiAgfVxuXG4gIGFzeW5jIHdyaXRlRmllbGQoZmllbGQ6IHN0cmluZywgdmFsdWU6IHN0cmluZykge1xuICAgIGNvbnN0IGYgPSBhd2FpdCB0aGlzLmNyZWF0ZUZvcm1GaWVsZChmaWVsZCk7XG4gICAgYXdhaXQgZi53cml0ZShlbmNvZGVyLmVuY29kZSh2YWx1ZSkpO1xuICB9XG5cbiAgYXN5bmMgd3JpdGVGaWxlKFxuICAgIGZpZWxkOiBzdHJpbmcsXG4gICAgZmlsZW5hbWU6IHN0cmluZyxcbiAgICBmaWxlOiBEZW5vLlJlYWRlcixcbiAgKSB7XG4gICAgY29uc3QgZiA9IGF3YWl0IHRoaXMuY3JlYXRlRm9ybUZpbGUoZmllbGQsIGZpbGVuYW1lKTtcbiAgICBhd2FpdCBEZW5vLmNvcHkoZmlsZSwgZik7XG4gIH1cblxuICBwcml2YXRlIGZsdXNoKCkge1xuICAgIHJldHVybiB0aGlzLmJ1ZldyaXRlci5mbHVzaCgpO1xuICB9XG5cbiAgLyoqIENsb3NlIHdyaXRlci4gTm8gYWRkaXRpb25hbCBkYXRhIGNhbiBiZSB3cml0dGVuIHRvIHN0cmVhbSAqL1xuICBhc3luYyBjbG9zZSgpIHtcbiAgICBpZiAodGhpcy5pc0Nsb3NlZCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwibXVsdGlwYXJ0OiB3cml0ZXIgaXMgY2xvc2VkXCIpO1xuICAgIH1cbiAgICBpZiAodGhpcy5sYXN0UGFydCkge1xuICAgICAgdGhpcy5sYXN0UGFydC5jbG9zZSgpO1xuICAgICAgdGhpcy5sYXN0UGFydCA9IHZvaWQgMDtcbiAgICB9XG4gICAgYXdhaXQgdGhpcy53cml0ZXIud3JpdGUoZW5jb2Rlci5lbmNvZGUoYFxcclxcbi0tJHt0aGlzLmJvdW5kYXJ5fS0tXFxyXFxuYCkpO1xuICAgIGF3YWl0IHRoaXMuZmx1c2goKTtcbiAgICB0aGlzLmlzQ2xvc2VkID0gdHJ1ZTtcbiAgfVxufVxuIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLEVBQTBFLEFBQTFFLHdFQUEwRTtBQUMxRSxNQUFNLEdBQUcsTUFBTSxFQUFFLE9BQU8sRUFBRSxXQUFXLEVBQUUsVUFBVSxRQUFRLENBQWlCO0FBQzFFLE1BQU0sR0FBRyxLQUFLLFFBQVEsQ0FBaUI7QUFDdkMsTUFBTSxHQUFHLFdBQVcsUUFBUSxDQUFrQjtBQUM5QyxNQUFNLEdBQUcsT0FBTyxRQUFRLENBQWdCO0FBQ3hDLE1BQU0sR0FBRyxTQUFTLEVBQUUsU0FBUyxRQUFRLENBQWdCO0FBQ3JELE1BQU0sR0FBRyxNQUFNLFFBQVEsQ0FBb0I7QUFDM0MsTUFBTSxHQUFHLGVBQWUsUUFBUSxDQUFxQjtBQUNyRCxNQUFNLEdBQUcsY0FBYyxRQUFRLENBQThCO0FBQzdELE1BQU0sR0FBRyxNQUFNLFFBQVEsQ0FBaUI7QUFrQnhDLEVBQThCLEFBQTlCLDBCQUE4QixBQUE5QixFQUE4QixDQUM5QixFQUFtQyxBQUFuQyxpQ0FBbUM7QUFDbkMsTUFBTSxVQUFVLFVBQVUsQ0FBQyxDQUFNLEVBQWlCLENBQUM7SUFDakQsTUFBTSxDQUFDLGNBQWMsQ0FBQyxDQUFDLEVBQUUsQ0FBVSxjQUFLLGNBQWMsQ0FBQyxDQUFDLEVBQUUsQ0FBTTtBQUNsRSxDQUFDO1NBRVEsY0FBYyxHQUFXLENBQUM7SUFDakMsR0FBRyxDQUFDLFFBQVEsR0FBRyxDQUE0QjtJQUMzQyxHQUFHLENBQUUsR0FBRyxDQUFDLENBQUMs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