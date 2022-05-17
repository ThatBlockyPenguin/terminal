// Copyright 2018-2021 the Deno authors. All rights reserved. MIT license.
import { hasOwnProperty } from "../_util/has_own_property.ts";
import { BufReader, BufWriter } from "../io/bufio.ts";
import { readLong, readShort, sliceLongToBytes } from "../io/ioutil.ts";
import { Sha1 } from "../hash/sha1.ts";
import { writeResponse } from "../http/_io.ts";
import { TextProtoReader } from "../textproto/mod.ts";
import { deferred } from "../async/deferred.ts";
import { assert } from "../_util/assert.ts";
import { concat } from "../bytes/mod.ts";
export var OpCode;
(function(OpCode) {
    OpCode[OpCode["Continue"] = 0] = "Continue";
    OpCode[OpCode["TextFrame"] = 1] = "TextFrame";
    OpCode[OpCode["BinaryFrame"] = 2] = "BinaryFrame";
    OpCode[OpCode["Close"] = 8] = "Close";
    OpCode[OpCode["Ping"] = 9] = "Ping";
    OpCode[OpCode["Pong"] = 10] = "Pong";
})(OpCode || (OpCode = {
}));
/** Returns true if input value is a WebSocketCloseEvent, false otherwise. */ export function isWebSocketCloseEvent(a) {
    return hasOwnProperty(a, "code");
}
/** Returns true if input value is a WebSocketPingEvent, false otherwise. */ export function isWebSocketPingEvent(a) {
    return Array.isArray(a) && a[0] === "ping" && a[1] instanceof Uint8Array;
}
/** Returns true if input value is a WebSocketPongEvent, false otherwise. */ export function isWebSocketPongEvent(a) {
    return Array.isArray(a) && a[0] === "pong" && a[1] instanceof Uint8Array;
}
/** Unmask masked websocket payload */ export function unmask(payload, mask) {
    if (mask) {
        for(let i = 0, len = payload.length; i < len; i++){
            payload[i] ^= mask[i & 3];
        }
    }
}
/** Write WebSocket frame to inputted writer. */ export async function writeFrame(frame, writer) {
    const payloadLength = frame.payload.byteLength;
    let header;
    const hasMask = frame.mask ? 128 : 0;
    if (frame.mask && frame.mask.byteLength !== 4) {
        throw new Error("invalid mask. mask must be 4 bytes: length=" + frame.mask.byteLength);
    }
    if (payloadLength < 126) {
        header = new Uint8Array([
            128 | frame.opcode,
            hasMask | payloadLength
        ]);
    } else if (payloadLength < 65535) {
        header = new Uint8Array([
            128 | frame.opcode,
            hasMask | 126,
            payloadLength >>> 8,
            payloadLength & 255, 
        ]);
    } else {
        header = new Uint8Array([
            128 | frame.opcode,
            hasMask | 127,
            ...sliceLongToBytes(payloadLength), 
        ]);
    }
    if (frame.mask) {
        header = concat(header, frame.mask);
    }
    unmask(frame.payload, frame.mask);
    header = concat(header, frame.payload);
    const w = BufWriter.create(writer);
    await w.write(header);
    await w.flush();
}
/** Read websocket frame from given BufReader
 * @throws `Deno.errors.UnexpectedEof` When peer closed connection without close frame
 * @throws `Error` Frame is invalid
 */ export async function readFrame(buf) {
    let b = await buf.readByte();
    assert(b !== null);
    let isLastFrame = false;
    switch(b >>> 4){
        case 8:
            isLastFrame = true;
            break;
        case 0:
            isLastFrame = false;
            break;
        default:
            throw new Error("invalid signature");
    }
    const opcode = b & 15;
    // has_mask & payload
    b = await buf.readByte();
    assert(b !== null);
    const hasMask = b >>> 7;
    let payloadLength = b & 127;
    if (payloadLength === 126) {
        const l = await readShort(buf);
        assert(l !== null);
        payloadLength = l;
    } else if (payloadLength === 127) {
        const l = await readLong(buf);
        assert(l !== null);
        payloadLength = Number(l);
    }
    // mask
    let mask;
    if (hasMask) {
        mask = new Uint8Array(4);
        assert(await buf.readFull(mask) !== null);
    }
    // payload
    const payload = new Uint8Array(payloadLength);
    assert(await buf.readFull(payload) !== null);
    return {
        isLastFrame,
        opcode,
        mask,
        payload
    };
}
class WebSocketImpl {
    conn;
    mask;
    bufReader;
    bufWriter;
    sendQueue = [];
    constructor({ conn , bufReader , bufWriter , mask  }){
        this.conn = conn;
        this.mask = mask;
        this.bufReader = bufReader || new BufReader(conn);
        this.bufWriter = bufWriter || new BufWriter(conn);
    }
    async *[Symbol.asyncIterator]() {
        const decoder = new TextDecoder();
        let frames = [];
        let payloadsLength = 0;
        while(!this._isClosed){
            let frame;
            try {
                frame = await readFrame(this.bufReader);
            } catch  {
                this.ensureSocketClosed();
                break;
            }
            unmask(frame.payload, frame.mask);
            switch(frame.opcode){
                case OpCode.TextFrame:
                case OpCode.BinaryFrame:
                case OpCode.Continue:
                    frames.push(frame);
                    payloadsLength += frame.payload.length;
                    if (frame.isLastFrame) {
                        const concat = new Uint8Array(payloadsLength);
                        let offs = 0;
                        for (const frame of frames){
                            concat.set(frame.payload, offs);
                            offs += frame.payload.length;
                        }
                        if (frames[0].opcode === OpCode.TextFrame) {
                            // text
                            yield decoder.decode(concat);
                        } else {
                            // binary
                            yield concat;
                        }
                        frames = [];
                        payloadsLength = 0;
                    }
                    break;
                case OpCode.Close:
                    {
                        // [0x12, 0x34] -> 0x1234
                        const code = frame.payload[0] << 8 | frame.payload[1];
                        const reason = decoder.decode(frame.payload.subarray(2, frame.payload.length));
                        await this.close(code, reason);
                        yield {
                            code,
                            reason
                        };
                        return;
                    }
                case OpCode.Ping:
                    await this.enqueue({
                        opcode: OpCode.Pong,
                        payload: frame.payload,
                        isLastFrame: true
                    });
                    yield [
                        "ping",
                        frame.payload
                    ];
                    break;
                case OpCode.Pong:
                    yield [
                        "pong",
                        frame.payload
                    ];
                    break;
                default:
            }
        }
    }
    dequeue() {
        const [entry] = this.sendQueue;
        if (!entry) return;
        if (this._isClosed) return;
        const { d , frame  } = entry;
        writeFrame(frame, this.bufWriter).then(()=>d.resolve()
        ).catch((e)=>d.reject(e)
        ).finally(()=>{
            this.sendQueue.shift();
            this.dequeue();
        });
    }
    enqueue(frame) {
        if (this._isClosed) {
            throw new Deno.errors.ConnectionReset("Socket has already been closed");
        }
        const d = deferred();
        this.sendQueue.push({
            d,
            frame
        });
        if (this.sendQueue.length === 1) {
            this.dequeue();
        }
        return d;
    }
    send(data) {
        const opcode = typeof data === "string" ? OpCode.TextFrame : OpCode.BinaryFrame;
        const payload = typeof data === "string" ? new TextEncoder().encode(data) : data;
        const isLastFrame = true;
        const frame = {
            isLastFrame,
            opcode,
            payload,
            mask: this.mask
        };
        return this.enqueue(frame);
    }
    ping(data = "") {
        const payload = typeof data === "string" ? new TextEncoder().encode(data) : data;
        const frame = {
            isLastFrame: true,
            opcode: OpCode.Ping,
            mask: this.mask,
            payload
        };
        return this.enqueue(frame);
    }
    _isClosed = false;
    get isClosed() {
        return this._isClosed;
    }
    async close(code = 1000, reason) {
        try {
            const header = [
                code >>> 8,
                code & 255
            ];
            let payload;
            if (reason) {
                const reasonBytes = new TextEncoder().encode(reason);
                payload = new Uint8Array(2 + reasonBytes.byteLength);
                payload.set(header);
                payload.set(reasonBytes, 2);
            } else {
                payload = new Uint8Array(header);
            }
            await this.enqueue({
                isLastFrame: true,
                opcode: OpCode.Close,
                mask: this.mask,
                payload
            });
        } catch (e) {
            throw e;
        } finally{
            this.ensureSocketClosed();
        }
    }
    closeForce() {
        this.ensureSocketClosed();
    }
    ensureSocketClosed() {
        if (this.isClosed) return;
        try {
            this.conn.close();
        } catch (e) {
            console.error(e);
        } finally{
            this._isClosed = true;
            const rest = this.sendQueue;
            this.sendQueue = [];
            rest.forEach((e)=>e.d.reject(new Deno.errors.ConnectionReset("Socket has already been closed"))
            );
        }
    }
}
/** Returns true if input headers are usable for WebSocket, otherwise false.  */ export function acceptable(req) {
    const upgrade = req.headers.get("upgrade");
    if (!upgrade || upgrade.toLowerCase() !== "websocket") {
        return false;
    }
    const secKey = req.headers.get("sec-websocket-key");
    return req.headers.has("sec-websocket-key") && typeof secKey === "string" && secKey.length > 0;
}
const kGUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
/** Create value of Sec-WebSocket-Accept header from inputted nonce. */ export function createSecAccept(nonce) {
    const sha1 = new Sha1();
    sha1.update(nonce + kGUID);
    const bytes = sha1.digest();
    return btoa(String.fromCharCode(...bytes));
}
/** Upgrade inputted TCP connection into WebSocket connection. */ export async function acceptWebSocket(req) {
    const { conn , headers , bufReader , bufWriter  } = req;
    if (acceptable(req)) {
        const sock = new WebSocketImpl({
            conn,
            bufReader,
            bufWriter
        });
        const secKey = headers.get("sec-websocket-key");
        if (typeof secKey !== "string") {
            throw new Error("sec-websocket-key is not provided");
        }
        const secAccept = createSecAccept(secKey);
        const newHeaders = new Headers({
            Upgrade: "websocket",
            Connection: "Upgrade",
            "Sec-WebSocket-Accept": secAccept
        });
        const secProtocol = headers.get("sec-websocket-protocol");
        if (typeof secProtocol === "string") {
            newHeaders.set("Sec-WebSocket-Protocol", secProtocol);
        }
        const secVersion = headers.get("sec-websocket-version");
        if (typeof secVersion === "string") {
            newHeaders.set("Sec-WebSocket-Version", secVersion);
        }
        await writeResponse(bufWriter, {
            status: 101,
            headers: newHeaders
        });
        return sock;
    }
    throw new Error("request is not acceptable");
}
const kSecChars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ-.~_";
/** Returns base64 encoded 16 bytes string for Sec-WebSocket-Key header. */ export function createSecKey() {
    let key = "";
    for(let i = 0; i < 16; i++){
        const j = Math.floor(Math.random() * kSecChars.length);
        key += kSecChars[j];
    }
    return btoa(key);
}
export async function handshake(url, headers, bufReader, bufWriter) {
    const { hostname , pathname , search  } = url;
    const key = createSecKey();
    if (!headers.has("host")) {
        headers.set("host", hostname);
    }
    headers.set("upgrade", "websocket");
    headers.set("connection", "upgrade");
    headers.set("sec-websocket-key", key);
    headers.set("sec-websocket-version", "13");
    let headerStr = `GET ${pathname}${search} HTTP/1.1\r\n`;
    for (const [key1, value] of headers){
        headerStr += `${key1}: ${value}\r\n`;
    }
    headerStr += "\r\n";
    await bufWriter.write(new TextEncoder().encode(headerStr));
    await bufWriter.flush();
    const tpReader = new TextProtoReader(bufReader);
    const statusLine = await tpReader.readLine();
    if (statusLine === null) {
        throw new Deno.errors.UnexpectedEof();
    }
    const m = statusLine.match(/^(?<version>\S+) (?<statusCode>\S+) /);
    if (!m) {
        throw new Error("ws: invalid status line: " + statusLine);
    }
    assert(m.groups);
    const { version , statusCode  } = m.groups;
    if (version !== "HTTP/1.1" || statusCode !== "101") {
        throw new Error(`ws: server didn't accept handshake: ` + `version=${version}, statusCode=${statusCode}`);
    }
    const responseHeaders = await tpReader.readMIMEHeader();
    if (responseHeaders === null) {
        throw new Deno.errors.UnexpectedEof();
    }
    const expectedSecAccept = createSecAccept(key);
    const secAccept = responseHeaders.get("sec-websocket-accept");
    if (secAccept !== expectedSecAccept) {
        throw new Error(`ws: unexpected sec-websocket-accept header: ` + `expected=${expectedSecAccept}, actual=${secAccept}`);
    }
}
export function createWebSocket(params) {
    return new WebSocketImpl(params);
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbImh0dHBzOi8vZGVuby5sYW5kL3N0ZEAwLjk2LjAvd3MvbW9kLnRzIl0sInNvdXJjZXNDb250ZW50IjpbIi8vIENvcHlyaWdodCAyMDE4LTIwMjEgdGhlIERlbm8gYXV0aG9ycy4gQWxsIHJpZ2h0cyByZXNlcnZlZC4gTUlUIGxpY2Vuc2UuXG5pbXBvcnQgeyBoYXNPd25Qcm9wZXJ0eSB9IGZyb20gXCIuLi9fdXRpbC9oYXNfb3duX3Byb3BlcnR5LnRzXCI7XG5pbXBvcnQgeyBCdWZSZWFkZXIsIEJ1ZldyaXRlciB9IGZyb20gXCIuLi9pby9idWZpby50c1wiO1xuaW1wb3J0IHsgcmVhZExvbmcsIHJlYWRTaG9ydCwgc2xpY2VMb25nVG9CeXRlcyB9IGZyb20gXCIuLi9pby9pb3V0aWwudHNcIjtcbmltcG9ydCB7IFNoYTEgfSBmcm9tIFwiLi4vaGFzaC9zaGExLnRzXCI7XG5pbXBvcnQgeyB3cml0ZVJlc3BvbnNlIH0gZnJvbSBcIi4uL2h0dHAvX2lvLnRzXCI7XG5pbXBvcnQgeyBUZXh0UHJvdG9SZWFkZXIgfSBmcm9tIFwiLi4vdGV4dHByb3RvL21vZC50c1wiO1xuaW1wb3J0IHsgRGVmZXJyZWQsIGRlZmVycmVkIH0gZnJvbSBcIi4uL2FzeW5jL2RlZmVycmVkLnRzXCI7XG5pbXBvcnQgeyBhc3NlcnQgfSBmcm9tIFwiLi4vX3V0aWwvYXNzZXJ0LnRzXCI7XG5pbXBvcnQgeyBjb25jYXQgfSBmcm9tIFwiLi4vYnl0ZXMvbW9kLnRzXCI7XG5cbmV4cG9ydCBlbnVtIE9wQ29kZSB7XG4gIENvbnRpbnVlID0gMHgwLFxuICBUZXh0RnJhbWUgPSAweDEsXG4gIEJpbmFyeUZyYW1lID0gMHgyLFxuICBDbG9zZSA9IDB4OCxcbiAgUGluZyA9IDB4OSxcbiAgUG9uZyA9IDB4YSxcbn1cblxuZXhwb3J0IHR5cGUgV2ViU29ja2V0RXZlbnQgPVxuICB8IHN0cmluZ1xuICB8IFVpbnQ4QXJyYXlcbiAgfCBXZWJTb2NrZXRDbG9zZUV2ZW50IC8vIFJlY2VpdmVkIGFmdGVyIGNsb3NpbmcgY29ubmVjdGlvbiBmaW5pc2hlZC5cbiAgfCBXZWJTb2NrZXRQaW5nRXZlbnQgLy8gUmVjZWl2ZWQgYWZ0ZXIgcG9uZyBmcmFtZSByZXNwb25kZWQuXG4gIHwgV2ViU29ja2V0UG9uZ0V2ZW50O1xuXG5leHBvcnQgaW50ZXJmYWNlIFdlYlNvY2tldENsb3NlRXZlbnQge1xuICBjb2RlOiBudW1iZXI7XG4gIHJlYXNvbj86IHN0cmluZztcbn1cblxuLyoqIFJldHVybnMgdHJ1ZSBpZiBpbnB1dCB2YWx1ZSBpcyBhIFdlYlNvY2tldENsb3NlRXZlbnQsIGZhbHNlIG90aGVyd2lzZS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpc1dlYlNvY2tldENsb3NlRXZlbnQoXG4gIGE6IFdlYlNvY2tldEV2ZW50LFxuKTogYSBpcyBXZWJTb2NrZXRDbG9zZUV2ZW50IHtcbiAgcmV0dXJuIGhhc093blByb3BlcnR5KGEsIFwiY29kZVwiKTtcbn1cblxuZXhwb3J0IHR5cGUgV2ViU29ja2V0UGluZ0V2ZW50ID0gW1wicGluZ1wiLCBVaW50OEFycmF5XTtcblxuLyoqIFJldHVybnMgdHJ1ZSBpZiBpbnB1dCB2YWx1ZSBpcyBhIFdlYlNvY2tldFBpbmdFdmVudCwgZmFsc2Ugb3RoZXJ3aXNlLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGlzV2ViU29ja2V0UGluZ0V2ZW50KFxuICBhOiBXZWJTb2NrZXRFdmVudCxcbik6IGEgaXMgV2ViU29ja2V0UGluZ0V2ZW50IHtcbiAgcmV0dXJuIEFycmF5LmlzQXJyYXkoYSkgJiYgYVswXSA9PT0gXCJwaW5nXCIgJiYgYVsxXSBpbnN0YW5jZW9mIFVpbnQ4QXJyYXk7XG59XG5cbmV4cG9ydCB0eXBlIFdlYlNvY2tldFBvbmdFdmVudCA9IFtcInBvbmdcIiwgVWludDhBcnJheV07XG5cbi8qKiBSZXR1cm5zIHRydWUgaWYgaW5wdXQgdmFsdWUgaXMgYSBXZWJTb2NrZXRQb25nRXZlbnQsIGZhbHNlIG90aGVyd2lzZS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpc1dlYlNvY2tldFBvbmdFdmVudChcbiAgYTogV2ViU29ja2V0RXZlbnQsXG4pOiBhIGlzIFdlYlNvY2tldFBvbmdFdmVudCB7XG4gIHJldHVybiBBcnJheS5pc0FycmF5KGEpICYmIGFbMF0gPT09IFwicG9uZ1wiICYmIGFbMV0gaW5zdGFuY2VvZiBVaW50OEFycmF5O1xufVxuXG5leHBvcnQgdHlwZSBXZWJTb2NrZXRNZXNzYWdlID0gc3RyaW5nIHwgVWludDhBcnJheTtcblxuZXhwb3J0IGludGVyZmFjZSBXZWJTb2NrZXRGcmFtZSB7XG4gIGlzTGFzdEZyYW1lOiBib29sZWFuO1xuICBvcGNvZGU6IE9wQ29kZTtcbiAgbWFzaz86IFVpbnQ4QXJyYXk7XG4gIHBheWxvYWQ6IFVpbnQ4QXJyYXk7XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgV2ViU29ja2V0IGV4dGVuZHMgQXN5bmNJdGVyYWJsZTxXZWJTb2NrZXRFdmVudD4ge1xuICByZWFkb25seSBjb25uOiBEZW5vLkNvbm47XG4gIHJlYWRvbmx5IGlzQ2xvc2VkOiBib29sZWFuO1xuXG4gIFtTeW1ib2wuYXN5bmNJdGVyYXRvcl0oKTogQXN5bmNJdGVyYWJsZUl0ZXJhdG9yPFdlYlNvY2tldEV2ZW50PjtcblxuICAvKipcbiAgICogQHRocm93cyBgRGVuby5lcnJvcnMuQ29ubmVjdGlvblJlc2V0YFxuICAgKi9cbiAgc2VuZChkYXRhOiBXZWJTb2NrZXRNZXNzYWdlKTogUHJvbWlzZTx2b2lkPjtcblxuICAvKipcbiAgICogQHBhcmFtIGRhdGFcbiAgICogQHRocm93cyBgRGVuby5lcnJvcnMuQ29ubmVjdGlvblJlc2V0YFxuICAgKi9cbiAgcGluZyhkYXRhPzogV2ViU29ja2V0TWVzc2FnZSk6IFByb21pc2U8dm9pZD47XG5cbiAgLyoqIENsb3NlIGNvbm5lY3Rpb24gYWZ0ZXIgc2VuZGluZyBjbG9zZSBmcmFtZSB0byBwZWVyLlxuICAgKiBUaGlzIGlzIGNhbm9uaWNhbCB3YXkgb2YgZGlzY29ubmVjdGlvbiBidXQgaXQgbWF5IGhhbmcgYmVjYXVzZSBvZiBwZWVyJ3MgcmVzcG9uc2UgZGVsYXkuXG4gICAqIERlZmF1bHQgY2xvc2UgY29kZSBpcyAxMDAwIChOb3JtYWwgQ2xvc3VyZSlcbiAgICogQHRocm93cyBgRGVuby5lcnJvcnMuQ29ubmVjdGlvblJlc2V0YFxuICAgKi9cbiAgY2xvc2UoKTogUHJvbWlzZTx2b2lkPjtcbiAgY2xvc2UoY29kZTogbnVtYmVyKTogUHJvbWlzZTx2b2lkPjtcbiAgY2xvc2UoY29kZTogbnVtYmVyLCByZWFzb246IHN0cmluZyk6IFByb21pc2U8dm9pZD47XG5cbiAgLyoqIENsb3NlIGNvbm5lY3Rpb24gZm9yY2VseSB3aXRob3V0IHNlbmRpbmcgY2xvc2UgZnJhbWUgdG8gcGVlci5cbiAgICogIFRoaXMgaXMgYmFzaWNhbGx5IHVuZGVzaXJhYmxlIHdheSBvZiBkaXNjb25uZWN0aW9uLiBVc2UgY2FyZWZ1bGx5LiAqL1xuICBjbG9zZUZvcmNlKCk6IHZvaWQ7XG59XG5cbi8qKiBVbm1hc2sgbWFza2VkIHdlYnNvY2tldCBwYXlsb2FkICovXG5leHBvcnQgZnVuY3Rpb24gdW5tYXNrKHBheWxvYWQ6IFVpbnQ4QXJyYXksIG1hc2s/OiBVaW50OEFycmF5KTogdm9pZCB7XG4gIGlmIChtYXNrKSB7XG4gICAgZm9yIChsZXQgaSA9IDAsIGxlbiA9IHBheWxvYWQubGVuZ3RoOyBpIDwgbGVuOyBpKyspIHtcbiAgICAgIHBheWxvYWRbaV0gXj0gbWFza1tpICYgM107XG4gICAgfVxuICB9XG59XG5cbi8qKiBXcml0ZSBXZWJTb2NrZXQgZnJhbWUgdG8gaW5wdXR0ZWQgd3JpdGVyLiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHdyaXRlRnJhbWUoXG4gIGZyYW1lOiBXZWJTb2NrZXRGcmFtZSxcbiAgd3JpdGVyOiBEZW5vLldyaXRlcixcbikge1xuICBjb25zdCBwYXlsb2FkTGVuZ3RoID0gZnJhbWUucGF5bG9hZC5ieXRlTGVuZ3RoO1xuICBsZXQgaGVhZGVyOiBVaW50OEFycmF5O1xuICBjb25zdCBoYXNNYXNrID0gZnJhbWUubWFzayA/IDB4ODAgOiAwO1xuICBpZiAoZnJhbWUubWFzayAmJiBmcmFtZS5tYXNrLmJ5dGVMZW5ndGggIT09IDQpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICBcImludmFsaWQgbWFzay4gbWFzayBtdXN0IGJlIDQgYnl0ZXM6IGxlbmd0aD1cIiArIGZyYW1lLm1hc2suYnl0ZUxlbmd0aCxcbiAgICApO1xuICB9XG4gIGlmIChwYXlsb2FkTGVuZ3RoIDwgMTI2KSB7XG4gICAgaGVhZGVyID0gbmV3IFVpbnQ4QXJyYXkoWzB4ODAgfCBmcmFtZS5vcGNvZGUsIGhhc01hc2sgfCBwYXlsb2FkTGVuZ3RoXSk7XG4gIH0gZWxzZSBpZiAocGF5bG9hZExlbmd0aCA8IDB4ZmZmZikge1xuICAgIGhlYWRlciA9IG5ldyBVaW50OEFycmF5KFtcbiAgICAgIDB4ODAgfCBmcmFtZS5vcGNvZGUsXG4gICAgICBoYXNNYXNrIHwgMGIwMTExMTExMCxcbiAgICAgIHBheWxvYWRMZW5ndGggPj4+IDgsXG4gICAgICBwYXlsb2FkTGVuZ3RoICYgMHgwMGZmLFxuICAgIF0pO1xuICB9IGVsc2Uge1xuICAgIGhlYWRlciA9IG5ldyBVaW50OEFycmF5KFtcbiAgICAgIDB4ODAgfCBmcmFtZS5vcGNvZGUsXG4gICAgICBoYXNNYXNrIHwgMGIwMTExMTExMSxcbiAgICAgIC4uLnNsaWNlTG9uZ1RvQnl0ZXMocGF5bG9hZExlbmd0aCksXG4gICAgXSk7XG4gIH1cbiAgaWYgKGZyYW1lLm1hc2spIHtcbiAgICBoZWFkZXIgPSBjb25jYXQoaGVhZGVyLCBmcmFtZS5tYXNrKTtcbiAgfVxuICB1bm1hc2soZnJhbWUucGF5bG9hZCwgZnJhbWUubWFzayk7XG4gIGhlYWRlciA9IGNvbmNhdChoZWFkZXIsIGZyYW1lLnBheWxvYWQpO1xuICBjb25zdCB3ID0gQnVmV3JpdGVyLmNyZWF0ZSh3cml0ZXIpO1xuICBhd2FpdCB3LndyaXRlKGhlYWRlcik7XG4gIGF3YWl0IHcuZmx1c2goKTtcbn1cblxuLyoqIFJlYWQgd2Vic29ja2V0IGZyYW1lIGZyb20gZ2l2ZW4gQnVmUmVhZGVyXG4gKiBAdGhyb3dzIGBEZW5vLmVycm9ycy5VbmV4cGVjdGVkRW9mYCBXaGVuIHBlZXIgY2xvc2VkIGNvbm5lY3Rpb24gd2l0aG91dCBjbG9zZSBmcmFtZVxuICogQHRocm93cyBgRXJyb3JgIEZyYW1lIGlzIGludmFsaWRcbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHJlYWRGcmFtZShidWY6IEJ1ZlJlYWRlcik6IFByb21pc2U8V2ViU29ja2V0RnJhbWU+IHtcbiAgbGV0IGIgPSBhd2FpdCBidWYucmVhZEJ5dGUoKTtcbiAgYXNzZXJ0KGIgIT09IG51bGwpO1xuICBsZXQgaXNMYXN0RnJhbWUgPSBmYWxzZTtcbiAgc3dpdGNoIChiID4+PiA0KSB7XG4gICAgY2FzZSAwYjEwMDA6XG4gICAgICBpc0xhc3RGcmFtZSA9IHRydWU7XG4gICAgICBicmVhaztcbiAgICBjYXNlIDBiMDAwMDpcbiAgICAgIGlzTGFzdEZyYW1lID0gZmFsc2U7XG4gICAgICBicmVhaztcbiAgICBkZWZhdWx0OlxuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiaW52YWxpZCBzaWduYXR1cmVcIik7XG4gIH1cbiAgY29uc3Qgb3Bjb2RlID0gYiAmIDB4MGY7XG4gIC8vIGhhc19tYXNrICYgcGF5bG9hZFxuICBiID0gYXdhaXQgYnVmLnJlYWRCeXRlKCk7XG4gIGFzc2VydChiICE9PSBudWxsKTtcbiAgY29uc3QgaGFzTWFzayA9IGIgPj4+IDc7XG4gIGxldCBwYXlsb2FkTGVuZ3RoID0gYiAmIDBiMDExMTExMTE7XG4gIGlmIChwYXlsb2FkTGVuZ3RoID09PSAxMjYpIHtcbiAgICBjb25zdCBsID0gYXdhaXQgcmVhZFNob3J0KGJ1Zik7XG4gICAgYXNzZXJ0KGwgIT09IG51bGwpO1xuICAgIHBheWxvYWRMZW5ndGggPSBsO1xuICB9IGVsc2UgaWYgKHBheWxvYWRMZW5ndGggPT09IDEyNykge1xuICAgIGNvbnN0IGwgPSBhd2FpdCByZWFkTG9uZyhidWYpO1xuICAgIGFzc2VydChsICE9PSBudWxsKTtcbiAgICBwYXlsb2FkTGVuZ3RoID0gTnVtYmVyKGwpO1xuICB9XG4gIC8vIG1hc2tcbiAgbGV0IG1hc2s6IFVpbnQ4QXJyYXkgfCB1bmRlZmluZWQ7XG4gIGlmIChoYXNNYXNrKSB7XG4gICAgbWFzayA9IG5ldyBVaW50OEFycmF5KDQpO1xuICAgIGFzc2VydCgoYXdhaXQgYnVmLnJlYWRGdWxsKG1hc2spKSAhPT0gbnVsbCk7XG4gIH1cbiAgLy8gcGF5bG9hZFxuICBjb25zdCBwYXlsb2FkID0gbmV3IFVpbnQ4QXJyYXkocGF5bG9hZExlbmd0aCk7XG4gIGFzc2VydCgoYXdhaXQgYnVmLnJlYWRGdWxsKHBheWxvYWQpKSAhPT0gbnVsbCk7XG4gIHJldHVybiB7XG4gICAgaXNMYXN0RnJhbWUsXG4gICAgb3Bjb2RlLFxuICAgIG1hc2ssXG4gICAgcGF5bG9hZCxcbiAgfTtcbn1cblxuY2xhc3MgV2ViU29ja2V0SW1wbCBpbXBsZW1lbnRzIFdlYlNvY2tldCB7XG4gIHJlYWRvbmx5IGNvbm46IERlbm8uQ29ubjtcbiAgcHJpdmF0ZSByZWFkb25seSBtYXNrPzogVWludDhBcnJheTtcbiAgcHJpdmF0ZSByZWFkb25seSBidWZSZWFkZXI6IEJ1ZlJlYWRlcjtcbiAgcHJpdmF0ZSByZWFkb25seSBidWZXcml0ZXI6IEJ1ZldyaXRlcjtcbiAgcHJpdmF0ZSBzZW5kUXVldWU6IEFycmF5PHtcbiAgICBmcmFtZTogV2ViU29ja2V0RnJhbWU7XG4gICAgZDogRGVmZXJyZWQ8dm9pZD47XG4gIH0+ID0gW107XG5cbiAgY29uc3RydWN0b3Ioe1xuICAgIGNvbm4sXG4gICAgYnVmUmVhZGVyLFxuICAgIGJ1ZldyaXRlcixcbiAgICBtYXNrLFxuICB9OiB7XG4gICAgY29ubjogRGVuby5Db25uO1xuICAgIGJ1ZlJlYWRlcj86IEJ1ZlJlYWRlcjtcbiAgICBidWZXcml0ZXI/OiBCdWZXcml0ZXI7XG4gICAgbWFzaz86IFVpbnQ4QXJyYXk7XG4gIH0pIHtcbiAgICB0aGlzLmNvbm4gPSBjb25uO1xuICAgIHRoaXMubWFzayA9IG1hc2s7XG4gICAgdGhpcy5idWZSZWFkZXIgPSBidWZSZWFkZXIgfHwgbmV3IEJ1ZlJlYWRlcihjb25uKTtcbiAgICB0aGlzLmJ1ZldyaXRlciA9IGJ1ZldyaXRlciB8fCBuZXcgQnVmV3JpdGVyKGNvbm4pO1xuICB9XG5cbiAgYXN5bmMgKltTeW1ib2wuYXN5bmNJdGVyYXRvcl0oKTogQXN5bmNJdGVyYWJsZUl0ZXJhdG9yPFdlYlNvY2tldEV2ZW50PiB7XG4gICAgY29uc3QgZGVjb2RlciA9IG5ldyBUZXh0RGVjb2RlcigpO1xuICAgIGxldCBmcmFtZXM6IFdlYlNvY2tldEZyYW1lW10gPSBbXTtcbiAgICBsZXQgcGF5bG9hZHNMZW5ndGggPSAwO1xuICAgIHdoaWxlICghdGhpcy5faXNDbG9zZWQpIHtcbiAgICAgIGxldCBmcmFtZTogV2ViU29ja2V0RnJhbWU7XG4gICAgICB0cnkge1xuICAgICAgICBmcmFtZSA9IGF3YWl0IHJlYWRGcmFtZSh0aGlzLmJ1ZlJlYWRlcik7XG4gICAgICB9IGNhdGNoIHtcbiAgICAgICAgdGhpcy5lbnN1cmVTb2NrZXRDbG9zZWQoKTtcbiAgICAgICAgYnJlYWs7XG4gICAgICB9XG4gICAgICB1bm1hc2soZnJhbWUucGF5bG9hZCwgZnJhbWUubWFzayk7XG4gICAgICBzd2l0Y2ggKGZyYW1lLm9wY29kZSkge1xuICAgICAgICBjYXNlIE9wQ29kZS5UZXh0RnJhbWU6XG4gICAgICAgIGNhc2UgT3BDb2RlLkJpbmFyeUZyYW1lOlxuICAgICAgICBjYXNlIE9wQ29kZS5Db250aW51ZTpcbiAgICAgICAgICBmcmFtZXMucHVzaChmcmFtZSk7XG4gICAgICAgICAgcGF5bG9hZHNMZW5ndGggKz0gZnJhbWUucGF5bG9hZC5sZW5ndGg7XG4gICAgICAgICAgaWYgKGZyYW1lLmlzTGFzdEZyYW1lKSB7XG4gICAgICAgICAgICBjb25zdCBjb25jYXQgPSBuZXcgVWludDhBcnJheShwYXlsb2Fkc0xlbmd0aCk7XG4gICAgICAgICAgICBsZXQgb2ZmcyA9IDA7XG4gICAgICAgICAgICBmb3IgKGNvbnN0IGZyYW1lIG9mIGZyYW1lcykge1xuICAgICAgICAgICAgICBjb25jYXQuc2V0KGZyYW1lLnBheWxvYWQsIG9mZnMpO1xuICAgICAgICAgICAgICBvZmZzICs9IGZyYW1lLnBheWxvYWQubGVuZ3RoO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKGZyYW1lc1swXS5vcGNvZGUgPT09IE9wQ29kZS5UZXh0RnJhbWUpIHtcbiAgICAgICAgICAgICAgLy8gdGV4dFxuICAgICAgICAgICAgICB5aWVsZCBkZWNvZGVyLmRlY29kZShjb25jYXQpO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgLy8gYmluYXJ5XG4gICAgICAgICAgICAgIHlpZWxkIGNvbmNhdDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGZyYW1lcyA9IFtdO1xuICAgICAgICAgICAgcGF5bG9hZHNMZW5ndGggPSAwO1xuICAgICAgICAgIH1cbiAgICAgICAgICBicmVhaztcbiAgICAgICAgY2FzZSBPcENvZGUuQ2xvc2U6IHtcbiAgICAgICAgICAvLyBbMHgxMiwgMHgzNF0gLT4gMHgxMjM0XG4gICAgICAgICAgY29uc3QgY29kZSA9IChmcmFtZS5wYXlsb2FkWzBdIDw8IDgpIHwgZnJhbWUucGF5bG9hZFsxXTtcbiAgICAgICAgICBjb25zdCByZWFzb24gPSBkZWNvZGVyLmRlY29kZShcbiAgICAgICAgICAgIGZyYW1lLnBheWxvYWQuc3ViYXJyYXkoMiwgZnJhbWUucGF5bG9hZC5sZW5ndGgpLFxuICAgICAgICAgICk7XG4gICAgICAgICAgYXdhaXQgdGhpcy5jbG9zZShjb2RlLCByZWFzb24pO1xuICAgICAgICAgIHlpZWxkIHsgY29kZSwgcmVhc29uIH07XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIGNhc2UgT3BDb2RlLlBpbmc6XG4gICAgICAgICAgYXdhaXQgdGhpcy5lbnF1ZXVlKHtcbiAgICAgICAgICAgIG9wY29kZTogT3BDb2RlLlBvbmcsXG4gICAgICAgICAgICBwYXlsb2FkOiBmcmFtZS5wYXlsb2FkLFxuICAgICAgICAgICAgaXNMYXN0RnJhbWU6IHRydWUsXG4gICAgICAgICAgfSk7XG4gICAgICAgICAgeWllbGQgW1wicGluZ1wiLCBmcmFtZS5wYXlsb2FkXSBhcyBXZWJTb2NrZXRQaW5nRXZlbnQ7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIGNhc2UgT3BDb2RlLlBvbmc6XG4gICAgICAgICAgeWllbGQgW1wicG9uZ1wiLCBmcmFtZS5wYXlsb2FkXSBhcyBXZWJTb2NrZXRQb25nRXZlbnQ7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIGRlZmF1bHQ6XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBkZXF1ZXVlKCk6IHZvaWQge1xuICAgIGNvbnN0IFtlbnRyeV0gPSB0aGlzLnNlbmRRdWV1ZTtcbiAgICBpZiAoIWVudHJ5KSByZXR1cm47XG4gICAgaWYgKHRoaXMuX2lzQ2xvc2VkKSByZXR1cm47XG4gICAgY29uc3QgeyBkLCBmcmFtZSB9ID0gZW50cnk7XG4gICAgd3JpdGVGcmFtZShmcmFtZSwgdGhpcy5idWZXcml0ZXIpXG4gICAgICAudGhlbigoKSA9PiBkLnJlc29sdmUoKSlcbiAgICAgIC5jYXRjaCgoZSkgPT4gZC5yZWplY3QoZSkpXG4gICAgICAuZmluYWxseSgoKSA9PiB7XG4gICAgICAgIHRoaXMuc2VuZFF1ZXVlLnNoaWZ0KCk7XG4gICAgICAgIHRoaXMuZGVxdWV1ZSgpO1xuICAgICAgfSk7XG4gIH1cblxuICBwcml2YXRlIGVucXVldWUoZnJhbWU6IFdlYlNvY2tldEZyYW1lKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKHRoaXMuX2lzQ2xvc2VkKSB7XG4gICAgICB0aHJvdyBuZXcgRGVuby5lcnJvcnMuQ29ubmVjdGlvblJlc2V0KFwiU29ja2V0IGhhcyBhbHJlYWR5IGJlZW4gY2xvc2VkXCIpO1xuICAgIH1cbiAgICBjb25zdCBkID0gZGVmZXJyZWQ8dm9pZD4oKTtcbiAgICB0aGlzLnNlbmRRdWV1ZS5wdXNoKHsgZCwgZnJhbWUgfSk7XG4gICAgaWYgKHRoaXMuc2VuZFF1ZXVlLmxlbmd0aCA9PT0gMSkge1xuICAgICAgdGhpcy5kZXF1ZXVlKCk7XG4gICAgfVxuICAgIHJldHVybiBkO1xuICB9XG5cbiAgc2VuZChkYXRhOiBXZWJTb2NrZXRNZXNzYWdlKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3Qgb3Bjb2RlID0gdHlwZW9mIGRhdGEgPT09IFwic3RyaW5nXCJcbiAgICAgID8gT3BDb2RlLlRleHRGcmFtZVxuICAgICAgOiBPcENvZGUuQmluYXJ5RnJhbWU7XG4gICAgY29uc3QgcGF5bG9hZCA9IHR5cGVvZiBkYXRhID09PSBcInN0cmluZ1wiXG4gICAgICA/IG5ldyBUZXh0RW5jb2RlcigpLmVuY29kZShkYXRhKVxuICAgICAgOiBkYXRhO1xuICAgIGNvbnN0IGlzTGFzdEZyYW1lID0gdHJ1ZTtcbiAgICBjb25zdCBmcmFtZSA9IHtcbiAgICAgIGlzTGFzdEZyYW1lLFxuICAgICAgb3Bjb2RlLFxuICAgICAgcGF5bG9hZCxcbiAgICAgIG1hc2s6IHRoaXMubWFzayxcbiAgICB9O1xuICAgIHJldHVybiB0aGlzLmVucXVldWUoZnJhbWUpO1xuICB9XG5cbiAgcGluZyhkYXRhOiBXZWJTb2NrZXRNZXNzYWdlID0gXCJcIik6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IHBheWxvYWQgPSB0eXBlb2YgZGF0YSA9PT0gXCJzdHJpbmdcIlxuICAgICAgPyBuZXcgVGV4dEVuY29kZXIoKS5lbmNvZGUoZGF0YSlcbiAgICAgIDogZGF0YTtcbiAgICBjb25zdCBmcmFtZSA9IHtcbiAgICAgIGlzTGFzdEZyYW1lOiB0cnVlLFxuICAgICAgb3Bjb2RlOiBPcENvZGUuUGluZyxcbiAgICAgIG1hc2s6IHRoaXMubWFzayxcbiAgICAgIHBheWxvYWQsXG4gICAgfTtcbiAgICByZXR1cm4gdGhpcy5lbnF1ZXVlKGZyYW1lKTtcbiAgfVxuXG4gIHByaXZhdGUgX2lzQ2xvc2VkID0gZmFsc2U7XG4gIGdldCBpc0Nsb3NlZCgpOiBib29sZWFuIHtcbiAgICByZXR1cm4gdGhpcy5faXNDbG9zZWQ7XG4gIH1cblxuICBhc3luYyBjbG9zZShjb2RlID0gMTAwMCwgcmVhc29uPzogc3RyaW5nKSB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IGhlYWRlciA9IFtjb2RlID4+PiA4LCBjb2RlICYgMHgwMGZmXTtcbiAgICAgIGxldCBwYXlsb2FkOiBVaW50OEFycmF5O1xuICAgICAgaWYgKHJlYXNvbikge1xuICAgICAgICBjb25zdCByZWFzb25CeXRlcyA9IG5ldyBUZXh0RW5jb2RlcigpLmVuY29kZShyZWFzb24pO1xuICAgICAgICBwYXlsb2FkID0gbmV3IFVpbnQ4QXJyYXkoMiArIHJlYXNvbkJ5dGVzLmJ5dGVMZW5ndGgpO1xuICAgICAgICBwYXlsb2FkLnNldChoZWFkZXIpO1xuICAgICAgICBwYXlsb2FkLnNldChyZWFzb25CeXRlcywgMik7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBwYXlsb2FkID0gbmV3IFVpbnQ4QXJyYXkoaGVhZGVyKTtcbiAgICAgIH1cbiAgICAgIGF3YWl0IHRoaXMuZW5xdWV1ZSh7XG4gICAgICAgIGlzTGFzdEZyYW1lOiB0cnVlLFxuICAgICAgICBvcGNvZGU6IE9wQ29kZS5DbG9zZSxcbiAgICAgICAgbWFzazogdGhpcy5tYXNrLFxuICAgICAgICBwYXlsb2FkLFxuICAgICAgfSk7XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgdGhyb3cgZTtcbiAgICB9IGZpbmFsbHkge1xuICAgICAgdGhpcy5lbnN1cmVTb2NrZXRDbG9zZWQoKTtcbiAgICB9XG4gIH1cblxuICBjbG9zZUZvcmNlKCk6IHZvaWQge1xuICAgIHRoaXMuZW5zdXJlU29ja2V0Q2xvc2VkKCk7XG4gIH1cblxuICBwcml2YXRlIGVuc3VyZVNvY2tldENsb3NlZCgpOiB2b2lkIHtcbiAgICBpZiAodGhpcy5pc0Nsb3NlZCkgcmV0dXJuO1xuICAgIHRyeSB7XG4gICAgICB0aGlzLmNvbm4uY2xvc2UoKTtcbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICBjb25zb2xlLmVycm9yKGUpO1xuICAgIH0gZmluYWxseSB7XG4gICAgICB0aGlzLl9pc0Nsb3NlZCA9IHRydWU7XG4gICAgICBjb25zdCByZXN0ID0gdGhpcy5zZW5kUXVldWU7XG4gICAgICB0aGlzLnNlbmRRdWV1ZSA9IFtdO1xuICAgICAgcmVzdC5mb3JFYWNoKChlKSA9PlxuICAgICAgICBlLmQucmVqZWN0KFxuICAgICAgICAgIG5ldyBEZW5vLmVycm9ycy5Db25uZWN0aW9uUmVzZXQoXCJTb2NrZXQgaGFzIGFscmVhZHkgYmVlbiBjbG9zZWRcIiksXG4gICAgICAgIClcbiAgICAgICk7XG4gICAgfVxuICB9XG59XG5cbi8qKiBSZXR1cm5zIHRydWUgaWYgaW5wdXQgaGVhZGVycyBhcmUgdXNhYmxlIGZvciBXZWJTb2NrZXQsIG90aGVyd2lzZSBmYWxzZS4gICovXG5leHBvcnQgZnVuY3Rpb24gYWNjZXB0YWJsZShyZXE6IHsgaGVhZGVyczogSGVhZGVycyB9KTogYm9vbGVhbiB7XG4gIGNvbnN0IHVwZ3JhZGUgPSByZXEuaGVhZGVycy5nZXQoXCJ1cGdyYWRlXCIpO1xuICBpZiAoIXVwZ3JhZGUgfHwgdXBncmFkZS50b0xvd2VyQ2FzZSgpICE9PSBcIndlYnNvY2tldFwiKSB7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG4gIGNvbnN0IHNlY0tleSA9IHJlcS5oZWFkZXJzLmdldChcInNlYy13ZWJzb2NrZXQta2V5XCIpO1xuICByZXR1cm4gKFxuICAgIHJlcS5oZWFkZXJzLmhhcyhcInNlYy13ZWJzb2NrZXQta2V5XCIpICYmXG4gICAgdHlwZW9mIHNlY0tleSA9PT0gXCJzdHJpbmdcIiAmJlxuICAgIHNlY0tleS5sZW5ndGggPiAwXG4gICk7XG59XG5cbmNvbnN0IGtHVUlEID0gXCIyNThFQUZBNS1FOTE0LTQ3REEtOTVDQS1DNUFCMERDODVCMTFcIjtcblxuLyoqIENyZWF0ZSB2YWx1ZSBvZiBTZWMtV2ViU29ja2V0LUFjY2VwdCBoZWFkZXIgZnJvbSBpbnB1dHRlZCBub25jZS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVTZWNBY2NlcHQobm9uY2U6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IHNoYTEgPSBuZXcgU2hhMSgpO1xuICBzaGExLnVwZGF0ZShub25jZSArIGtHVUlEKTtcbiAgY29uc3QgYnl0ZXMgPSBzaGExLmRpZ2VzdCgpO1xuICByZXR1cm4gYnRvYShTdHJpbmcuZnJvbUNoYXJDb2RlKC4uLmJ5dGVzKSk7XG59XG5cbi8qKiBVcGdyYWRlIGlucHV0dGVkIFRDUCBjb25uZWN0aW9uIGludG8gV2ViU29ja2V0IGNvbm5lY3Rpb24uICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gYWNjZXB0V2ViU29ja2V0KHJlcToge1xuICBjb25uOiBEZW5vLkNvbm47XG4gIGJ1ZldyaXRlcjogQnVmV3JpdGVyO1xuICBidWZSZWFkZXI6IEJ1ZlJlYWRlcjtcbiAgaGVhZGVyczogSGVhZGVycztcbn0pOiBQcm9taXNlPFdlYlNvY2tldD4ge1xuICBjb25zdCB7IGNvbm4sIGhlYWRlcnMsIGJ1ZlJlYWRlciwgYnVmV3JpdGVyIH0gPSByZXE7XG4gIGlmIChhY2NlcHRhYmxlKHJlcSkpIHtcbiAgICBjb25zdCBzb2NrID0gbmV3IFdlYlNvY2tldEltcGwoeyBjb25uLCBidWZSZWFkZXIsIGJ1ZldyaXRlciB9KTtcbiAgICBjb25zdCBzZWNLZXkgPSBoZWFkZXJzLmdldChcInNlYy13ZWJzb2NrZXQta2V5XCIpO1xuICAgIGlmICh0eXBlb2Ygc2VjS2V5ICE9PSBcInN0cmluZ1wiKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJzZWMtd2Vic29ja2V0LWtleSBpcyBub3QgcHJvdmlkZWRcIik7XG4gICAgfVxuICAgIGNvbnN0IHNlY0FjY2VwdCA9IGNyZWF0ZVNlY0FjY2VwdChzZWNLZXkpO1xuICAgIGNvbnN0IG5ld0hlYWRlcnMgPSBuZXcgSGVhZGVycyh7XG4gICAgICBVcGdyYWRlOiBcIndlYnNvY2tldFwiLFxuICAgICAgQ29ubmVjdGlvbjogXCJVcGdyYWRlXCIsXG4gICAgICBcIlNlYy1XZWJTb2NrZXQtQWNjZXB0XCI6IHNlY0FjY2VwdCxcbiAgICB9KTtcbiAgICBjb25zdCBzZWNQcm90b2NvbCA9IGhlYWRlcnMuZ2V0KFwic2VjLXdlYnNvY2tldC1wcm90b2NvbFwiKTtcbiAgICBpZiAodHlwZW9mIHNlY1Byb3RvY29sID09PSBcInN0cmluZ1wiKSB7XG4gICAgICBuZXdIZWFkZXJzLnNldChcIlNlYy1XZWJTb2NrZXQtUHJvdG9jb2xcIiwgc2VjUHJvdG9jb2wpO1xuICAgIH1cbiAgICBjb25zdCBzZWNWZXJzaW9uID0gaGVhZGVycy5nZXQoXCJzZWMtd2Vic29ja2V0LXZlcnNpb25cIik7XG4gICAgaWYgKHR5cGVvZiBzZWNWZXJzaW9uID09PSBcInN0cmluZ1wiKSB7XG4gICAgICBuZXdIZWFkZXJzLnNldChcIlNlYy1XZWJTb2NrZXQtVmVyc2lvblwiLCBzZWNWZXJzaW9uKTtcbiAgICB9XG4gICAgYXdhaXQgd3JpdGVSZXNwb25zZShidWZXcml0ZXIsIHtcbiAgICAgIHN0YXR1czogMTAxLFxuICAgICAgaGVhZGVyczogbmV3SGVhZGVycyxcbiAgICB9KTtcbiAgICByZXR1cm4gc29jaztcbiAgfVxuICB0aHJvdyBuZXcgRXJyb3IoXCJyZXF1ZXN0IGlzIG5vdCBhY2NlcHRhYmxlXCIpO1xufVxuXG5jb25zdCBrU2VjQ2hhcnMgPSBcImFiY2RlZmdoaWprbG1ub3BxcnN0dXZ3eHl6QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVotLn5fXCI7XG5cbi8qKiBSZXR1cm5zIGJhc2U2NCBlbmNvZGVkIDE2IGJ5dGVzIHN0cmluZyBmb3IgU2VjLVdlYlNvY2tldC1LZXkgaGVhZGVyLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZVNlY0tleSgpOiBzdHJpbmcge1xuICBsZXQga2V5ID0gXCJcIjtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCAxNjsgaSsrKSB7XG4gICAgY29uc3QgaiA9IE1hdGguZmxvb3IoTWF0aC5yYW5kb20oKSAqIGtTZWNDaGFycy5sZW5ndGgpO1xuICAgIGtleSArPSBrU2VjQ2hhcnNbal07XG4gIH1cbiAgcmV0dXJuIGJ0b2Eoa2V5KTtcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGhhbmRzaGFrZShcbiAgdXJsOiBVUkwsXG4gIGhlYWRlcnM6IEhlYWRlcnMsXG4gIGJ1ZlJlYWRlcjogQnVmUmVhZGVyLFxuICBidWZXcml0ZXI6IEJ1ZldyaXRlcixcbikge1xuICBjb25zdCB7IGhvc3RuYW1lLCBwYXRobmFtZSwgc2VhcmNoIH0gPSB1cmw7XG4gIGNvbnN0IGtleSA9IGNyZWF0ZVNlY0tleSgpO1xuXG4gIGlmICghaGVhZGVycy5oYXMoXCJob3N0XCIpKSB7XG4gICAgaGVhZGVycy5zZXQoXCJob3N0XCIsIGhvc3RuYW1lKTtcbiAgfVxuICBoZWFkZXJzLnNldChcInVwZ3JhZGVcIiwgXCJ3ZWJzb2NrZXRcIik7XG4gIGhlYWRlcnMuc2V0KFwiY29ubmVjdGlvblwiLCBcInVwZ3JhZGVcIik7XG4gIGhlYWRlcnMuc2V0KFwic2VjLXdlYnNvY2tldC1rZXlcIiwga2V5KTtcbiAgaGVhZGVycy5zZXQoXCJzZWMtd2Vic29ja2V0LXZlcnNpb25cIiwgXCIxM1wiKTtcblxuICBsZXQgaGVhZGVyU3RyID0gYEdFVCAke3BhdGhuYW1lfSR7c2VhcmNofSBIVFRQLzEuMVxcclxcbmA7XG4gIGZvciAoY29uc3QgW2tleSwgdmFsdWVdIG9mIGhlYWRlcnMpIHtcbiAgICBoZWFkZXJTdHIgKz0gYCR7a2V5fTogJHt2YWx1ZX1cXHJcXG5gO1xuICB9XG4gIGhlYWRlclN0ciArPSBcIlxcclxcblwiO1xuXG4gIGF3YWl0IGJ1ZldyaXRlci53cml0ZShuZXcgVGV4dEVuY29kZXIoKS5lbmNvZGUoaGVhZGVyU3RyKSk7XG4gIGF3YWl0IGJ1ZldyaXRlci5mbHVzaCgpO1xuXG4gIGNvbnN0IHRwUmVhZGVyID0gbmV3IFRleHRQcm90b1JlYWRlcihidWZSZWFkZXIpO1xuICBjb25zdCBzdGF0dXNMaW5lID0gYXdhaXQgdHBSZWFkZXIucmVhZExpbmUoKTtcbiAgaWYgKHN0YXR1c0xpbmUgPT09IG51bGwpIHtcbiAgICB0aHJvdyBuZXcgRGVuby5lcnJvcnMuVW5leHBlY3RlZEVvZigpO1xuICB9XG4gIGNvbnN0IG0gPSBzdGF0dXNMaW5lLm1hdGNoKC9eKD88dmVyc2lvbj5cXFMrKSAoPzxzdGF0dXNDb2RlPlxcUyspIC8pO1xuICBpZiAoIW0pIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJ3czogaW52YWxpZCBzdGF0dXMgbGluZTogXCIgKyBzdGF0dXNMaW5lKTtcbiAgfVxuXG4gIGFzc2VydChtLmdyb3Vwcyk7XG4gIGNvbnN0IHsgdmVyc2lvbiwgc3RhdHVzQ29kZSB9ID0gbS5ncm91cHM7XG4gIGlmICh2ZXJzaW9uICE9PSBcIkhUVFAvMS4xXCIgfHwgc3RhdHVzQ29kZSAhPT0gXCIxMDFcIikge1xuICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgIGB3czogc2VydmVyIGRpZG4ndCBhY2NlcHQgaGFuZHNoYWtlOiBgICtcbiAgICAgICAgYHZlcnNpb249JHt2ZXJzaW9ufSwgc3RhdHVzQ29kZT0ke3N0YXR1c0NvZGV9YCxcbiAgICApO1xuICB9XG5cbiAgY29uc3QgcmVzcG9uc2VIZWFkZXJzID0gYXdhaXQgdHBSZWFkZXIucmVhZE1JTUVIZWFkZXIoKTtcbiAgaWYgKHJlc3BvbnNlSGVhZGVycyA9PT0gbnVsbCkge1xuICAgIHRocm93IG5ldyBEZW5vLmVycm9ycy5VbmV4cGVjdGVkRW9mKCk7XG4gIH1cblxuICBjb25zdCBleHBlY3RlZFNlY0FjY2VwdCA9IGNyZWF0ZVNlY0FjY2VwdChrZXkpO1xuICBjb25zdCBzZWNBY2NlcHQgPSByZXNwb25zZUhlYWRlcnMuZ2V0KFwic2VjLXdlYnNvY2tldC1hY2NlcHRcIik7XG4gIGlmIChzZWNBY2NlcHQgIT09IGV4cGVjdGVkU2VjQWNjZXB0KSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgYHdzOiB1bmV4cGVjdGVkIHNlYy13ZWJzb2NrZXQtYWNjZXB0IGhlYWRlcjogYCArXG4gICAgICAgIGBleHBlY3RlZD0ke2V4cGVjdGVkU2VjQWNjZXB0fSwgYWN0dWFsPSR7c2VjQWNjZXB0fWAsXG4gICAgKTtcbiAgfVxufVxuXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlV2ViU29ja2V0KHBhcmFtczoge1xuICBjb25uOiBEZW5vLkNvbm47XG4gIGJ1ZldyaXRlcj86IEJ1ZldyaXRlcjtcbiAgYnVmUmVhZGVyPzogQnVmUmVhZGVyO1xuICBtYXNrPzogVWludDhBcnJheTtcbn0pOiBXZWJTb2NrZXQge1xuICByZXR1cm4gbmV3IFdlYlNvY2tldEltcGwocGFyYW1zKTtcbn1cbiJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxFQUEwRSxBQUExRSx3RUFBMEU7QUFDMUUsTUFBTSxHQUFHLGNBQWMsUUFBUSxDQUE4QjtBQUM3RCxNQUFNLEdBQUcsU0FBUyxFQUFFLFNBQVMsUUFBUSxDQUFnQjtBQUNyRCxNQUFNLEdBQUcsUUFBUSxFQUFFLFNBQVMsRUFBRSxnQkFBZ0IsUUFBUSxDQUFpQjtBQUN2RSxNQUFNLEdBQUcsSUFBSSxRQUFRLENBQWlCO0FBQ3RDLE1BQU0sR0FBRyxhQUFhLFFBQVEsQ0FBZ0I7QUFDOUMsTUFBTSxHQUFHLGVBQWUsUUFBUSxDQUFxQjtBQUNyRCxNQUFNLEdBQWEsUUFBUSxRQUFRLENBQXNCO0FBQ3pELE1BQU0sR0FBRyxNQUFNLFFBQVEsQ0FBb0I7QUFDM0MsTUFBTSxHQUFHLE1BQU0sUUFBUSxDQUFpQjtBQUVqQyxNQUFNO1VBQUQsTUFBTTtJQUFOLE1BQU0sQ0FBTixNQUFNLENBQ2hCLENBQVEsYUFBRyxDQUFHLElBQWQsQ0FBUTtJQURFLE1BQU0sQ0FBTixNQUFNLENBRWhCLENBQVMsY0FBRyxDQUFHLElBQWYsQ0FBUztJQUZDLE1BQU0sQ0FBTixNQUFNLENBR2hCLENBQVcsZ0JBQUcsQ0FBRyxJQUFqQixDQUFXO0lBSEQsTUFBTSxDQUFOLE1BQU0sQ0FJaEIsQ0FBSyxVQUFHLENBQUcsSUFBWCxDQUFLO0lBSkssTUFBTSxDQUFOLE1BQU0sQ0FLaEIsQ0FBSSxTQUFHLENBQUcsSUFBVixDQUFJO0lBTE0sTUFBTSxDQUFOLE1BQU0sQ0FNaEIsQ0FBSSxTQUFHLEVBQUcsSUFBVixDQUFJO0dBTk0sTUFBTSxLQUFOLE1BQU07O0FBcUJsQixFQUE2RSxBQUE3RSx5RUFBNkUsQUFBN0UsRUFBNkUsQ0FDN0UsTUFBTSxVQUFVLHFCQUFxQixDQUNuQyxDQUFpQixFQUNTLENBQUM7SUFDM0IsTUFBTSxDQUFDLGNBQWMsQ0FBQyxDQUFDLEVBQUUsQ0FBTTtBQUNqQyxDQUFDO0FBSUQsRUFBNEUsQUFBNUUsd0VBQTRFLEFBQTVFLEVBQTRFLENBQzVFLE1BQU0sVUFBVSxvQkFBb0IsQ0FDbEMsQ0FBaUIsRUFDUSxDQUFDO0lBQzFCLE1BQU0sQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQU0sU0FBSSxDQUFDLENBQUMsQ0FBQyxhQUFhLFVBQVU7QUFDMUUsQ0FBQztBQUlELEVBQTRFLEFBQTVFLHdFQUE0RSxBQUE1RSxFQUE0RSxDQUM1RSxNQUFNLFVBQVUsb0JBQW9CLENBQ2xDLENBQWlCLEVBQ1EsQ0FBQztJQUMxQixNQUFNLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFNLFNBQUksQ0FBQyxDQUFDLENBQUMsYUFBYSxVQUFVO0FBQzFFLENBQUM7QUEwQ0QsRUFBc0MsQUFBdEMsa0NBQXNDLEFBQXRDLEVBQXNDLENBQ3RDLE1BQU0sVUFBVSxNQUFNLENBQUMsT0FBbUIsRUFBRSxJQUFpQixFQUFRLENBQUM7SUFDcEUsRUFBRSxFQUFFLElBQUksRUFBRSxDQUFDO1FBQ1QsR0FBRyxDQUFFLEdBQUcsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxFQUFFLEdBQUcsR0FBRyxPQUFPLENBQUMsTUFBTSxFQUFFLENBQUMsR0FBRyxHQUFHLEVBQUUsQ0FBQyxHQUFJLENBQUM7WUFDbkQsT0FBTyxDQUFDLENBQUMsS0FBSyxJQUFJLENBQUMsQ0FBQyxHQUFHLENBQUM7UUFDMUIsQ0FBQztJQUNILENBQUM7QUFDSCxDQUFDO0FBRUQsRUFBZ0QsQUFBaEQsNENBQWdELEFBQWhELEVBQWdELENBQ2hELE1BQU0sZ0JBQWdCLFVBQVUsQ0FDOUIsS0FBcUIsRUFDckIsTUFBbUIsRUFDbkIsQ0FBQztJQUNELEtBQUssQ0FBQyxhQUFhLEdBQUcsS0FBSyxDQUFDLE9BQU8sQ0FBQyxVQUFVO0lBQzlDLEdBQUcsQ0FBQyxNQUFNO0lBQ1YsS0FBSyxDQUFDLE9BQU8sR0FBRyxLQUFLLENBQUMsSUFBSSxHQUFHLEdBQUksR0FBRyxDQUFDO0lBQ3JDLEVBQUUsRUFBRSxLQUFLLENBQUMsSUFBSSxJQUFJLEtBQUssQ0FBQyxJQUFJLENBQUMsVUFBVSxLQUFLLENBQUMsRUFBRSxDQUFDO1FBQzlDLEtBQUssQ0FBQyxHQUFHLENBQUMsS0FBSyxDQUNiLENBQTZDLCtDQUFHLEtBQUssQ0FBQyxJQUFJLENBQUMsVUFBVTtJQUV6RSxDQUFDO0lBQ0QsRUFBRSxFQUFFLGFBQWEsR0FBRyxHQUFHLEVBQUUsQ0FBQztRQUN4QixNQUFNLEdBQUcsR0FBRyxDQUFDLFVBQVUsQ0FBQyxDQUFDO1lBQUEsR0FBSSxHQUFHLEtBQUssQ0FBQyxNQUFNO1lBQUUsT0FBTyxHQUFHLGFBQWE7UUFBQSxDQUFDO0lBQ3hFLENBQUMsTUFBTSxFQUFFLEVBQUUsYUFBYSxHQUFHLEtBQU0sRUFBRSxDQUFDO1FBQ2xDLE1BQU0sR0FBRyxHQUFHLENBQUMsVUFBVSxDQUFDLENBQUM7WUFDdkIsR0FBSSxHQUFHLEtBQUssQ0FBQyxNQUFNO1lBQ25CLE9BQU8sR0FBRyxHQUFVO1lBQ3BCLGFBQWEsS0FBSyxDQUFDO1lBQ25CLGFBQWEsR0FBRyxHQUFNO1FBQ3hCLENBQUM7SUFDSCxDQUFDLE1BQU0sQ0FBQztRQUNOLE1BQU0sR0FBRyxHQUFHLENBQUMsVUFBVSxDQUFDLENBQUM7WUFDdkIsR0FBSSxHQUFHLEtBQUssQ0FBQyxNQUFNO1lBQ25CLE9BQU8sR0FBRyxHQUFVO2VBQ2pCLGdCQUFnQixDQUFDLGFBQWE7UUFDbkMsQ0FBQztJQUNILENBQUM7SUFDRCxFQUFFLEVBQUUsS0FBSyxDQUFDLElBQUksRUFBRSxDQUFDO1FBQ2YsTUFBTSxHQUFHLE1BQU0sQ0FBQyxNQUFNLEVBQUUsS0FBSyxDQUFDLElBQUk7SUFDcEMsQ0FBQztJQUNELE1BQU0sQ0FBQyxLQUFLLENBQUMsT0FBTyxFQUFFLEtBQUssQ0FBQyxJQUFJO0lBQ2hDLE1BQU0sR0FBRyxNQUFNLENBQUMsTUFBTSxFQUFFLEtBQUssQ0FBQyxPQUFPO0lBQ3JDLEtBQUssQ0FBQyxDQUFDLEdBQUcsU0FBUyxDQUFDLE1BQU0sQ0FBQyxNQUFNO0lBQ2pDLEtBQUssQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLE1BQU07SUFDcEIsS0FBSyxDQUFDLENBQUMsQ0FBQyxLQUFLO0FBQ2YsQ0FBQztBQUVELEVBR0csQUFISDs7O0NBR0csQUFISCxFQUdHLENBQ0gsTUFBTSxnQkFBZ0IsU0FBUyxDQUFDLEdBQWMsRUFBMkIsQ0FBQztJQUN4RSxHQUFHLENBQUMsQ0FBQyxHQUFHLEtBQUssQ0FBQyxHQUFHLENBQUMsUUFBUTtJQUMxQixNQUFNLENBQUMsQ0FBQyxLQUFLLElBQUk7SUFDakIsR0FBRyxDQUFDLFdBQVcsR0FBRyxLQUFLO0lBQ3ZCLE1BQU0sQ0FBRSxDQUFDLEtBQUssQ0FBQztRQUNiLElBQUksQ0FBQyxDQUFNO1lBQ1QsV0FBVyxHQUFHLElBQUk7WUFDbEIsS0FBSztRQUNQLElBQUksQ0FBQyxDQUFNO1lBQ1QsV0FBVyxHQUFHLEtBQUs7WUFDbkIsS0FBSzs7WUFFTCxLQUFLLENBQUMsR0FBRyxDQUFDLEtBQUssQ0FBQyxDQUFtQjs7SUFFdkMsS0FBSyxDQUFDLE1BQU0sR0FBRyxDQUFDLEdBQUcsRUFBSTtJQUN2QixFQUFxQixBQUFyQixtQkFBcUI7SUFDckIsQ0FBQyxHQUFHLEtBQUssQ0FBQyxHQUFHLENBQUMsUUFBUTtJQUN0QixNQUFNLENBQUMsQ0FBQyxLQUFLLElBQUk7SUFDakIsS0FBSyxDQUFDLE9BQU8sR0FBRyxDQUFDLEtBQUssQ0FBQztJQUN2QixHQUFHLENBQUMsYUFBYSxHQUFHLENBQUMsR0FBRyxHQUFVO0lBQ2xDLEVBQUUsRUFBRSxhQUFhLEtBQUssR0FBRyxFQUFFLENBQUM7UUFDMUIsS0FBSyxDQUFDLENBQUMsR0FBRyxLQUFLLENBQUMsU0FBUyxDQUFDLEdBQUc7UUFDN0IsTUFBTSxDQUFDLENBQUMsS0FBSyxJQUFJO1FBQ2pCLGFBQWEsR0FBRyxDQUFDO0lBQ25CLENBQUMsTUFBTSxFQUFFLEVBQUUsYUFBYSxLQUFLLEdBQUcsRUFBRSxDQUFDO1FBQ2pDLEtBQUssQ0FBQyxDQUFDLEdBQUcsS0FBSyxDQUFDLFFBQVEsQ0FBQyxHQUFHO1FBQzVCLE1BQU0sQ0FBQyxDQUFDLEtBQUssSUFBSTtRQUNqQixhQUFhLEdBQUcsTUFBTSxDQUFDLENBQUM7SUFDMUIsQ0FBQztJQUNELEVBQU8sQUFBUCxLQUFPO0lBQ1AsR0FBRyxDQUFDLElBQUk7SUFDUixFQUFFLEVBQUUsT0FBTyxFQUFFLENBQUM7UUFDWixJQUFJLEdBQUcsR0FBRyxDQUFDLFVBQVUsQ0FBQyxDQUFDO1FBQ3ZCLE1BQU0sQ0FBRSxLQUFLLENBQUMsR0FBRyxDQUFDLFFBQVEsQ0FBQyxJQUFJLE1BQU8sSUFBSTtJQUM1QyxDQUFDO0lBQ0QsRUFBVSxBQUFWLFFBQVU7SUFDVixLQUFLLENBQUMsT0FBTyxHQUFHLEdBQUcsQ0FBQyxVQUFVLENBQUMsYUFBYTtJQUM1QyxNQUFNLENBQUUsS0FBSyxDQUFDLEdBQUcsQ0FBQyxRQUFRLENBQUMsT0FBTyxNQUFPLElBQUk7SUFDN0MsTUFBTSxDQUFDLENBQUM7UUFDTixXQUFXO1FBQ1gsTUFBTTtRQUNOLElBQUk7UUFDSixPQUFPO0lBQ1QsQ0FBQztBQUNILENBQUM7TUFFSyxhQUFhO0lBQ1IsSUFBSTtJQUNJLElBQUk7SUFDSixTQUFTO0lBQ1QsU0FBUztJQUNsQixTQUFTLEdBR1osQ0FBQyxDQUFDO2dCQUVLLENBQUMsQ0FDWCxJQUFJLEdBQ0osU0FBUyxHQUNULFNBQVMsR0FDVCxJQUFJLEVBTU4sQ0FBQyxDQUFFLENBQUM7UUFDRixJQUFJLENBQUMsSUFBSSxHQUFHLElBQUk7UUFDaEIsSUFBSSxDQUFDLElBQUksR0FBRyxJQUFJO1FBQ2hCLElBQUksQ0FBQyxTQUFTLEdBQUcsU0FBUyxJQUFJLEdBQUcsQ0FBQyxTQUFTLENBQUMsSUFBSTtRQUNoRCxJQUFJLENBQUMsU0FBUyxHQUFHLFNBQVMsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUk7SUFDbEQsQ0FBQztZQUVPLE1BQU0sQ0FBQyxhQUFhLElBQTJDLENBQUM7UUFDdEUsS0FBSyxDQUFDLE9BQU8sR0FBRyxHQUFHLENBQUMsV0FBVztRQUMvQixHQUFHLENBQUMsTUFBTSxHQUFxQixDQUFDLENBQUM7UUFDakMsR0FBRyxDQUFDLGNBQWMsR0FBRyxDQUFDO2VBQ2QsSUFBSSxDQUFDLFNBQVMsQ0FBRSxDQUFDO1lBQ3ZCLEdBQUcsQ0FBQyxLQUFLO1lBQ1QsR0FBRyxDQUFDLENBQUM7Z0JBQ0gsS0FBSyxHQUFHLEtBQUssQ0FBQyxTQUFTLENBQUMsSUFBSSxDQUFDLFNBQVM7WUFDeEMsQ0FBQyxDQUFDLEtBQUssRUFBQyxDQUFDO2dCQUNQLElBQUksQ0FBQyxrQkFBa0I7Z0JBQ3ZCLEtBQUs7WUFDUCxDQUFDO1lBQ0QsTUFBTSxDQUFDLEtBQUssQ0FBQyxPQUFPLEVBQUUsS0FBSyxDQUFDLElBQUk7WUFDaEMsTUFBTSxDQUFFLEtBQUssQ0FBQyxNQUFNO2dCQUNsQixJQUFJLENBQUMsTUFBTSxDQUFDLFNBQVM7Z0JBQ3JCLElBQUksQ0FBQyxNQUFNLENBQUMsV0FBVztnQkFDdkIsSUFBSSxDQUFDLE1BQU0sQ0FBQyxRQUFRO29CQUNsQixNQUFNLENBQUMsSUFBSSxDQUFDLEtBQUs7b0JBQ2pCLGNBQWMsSUFBSSxLQUFLLENBQUMsT0FBTyxDQUFDLE1BQU07b0JBQ3RDLEVBQUUsRUFBRSxLQUFLLENBQUMsV0FBVyxFQUFFLENBQUM7d0JBQ3RCLEtBQUssQ0FBQyxNQUFNLEdBQUcsR0FBRyxDQUFDLFVBQVUsQ0FBQyxjQUFjO3dCQUM1QyxHQUFHLENBQUMsSUFBSSxHQUFHLENBQUM7d0JBQ1osR0FBRyxFQUFFLEtBQUssQ0FBQyxLQUFLLElBQUksTUFBTSxDQUFFLENBQUM7NEJBQzNCLE1BQU0sQ0FBQyxHQUFHLENBQUMsS0FBSyxDQUFDLE9BQU8sRUFBRSxJQUFJOzRCQUM5QixJQUFJLElBQUksS0FBSyxDQUFDLE9BQU8sQ0FBQyxNQUFNO3dCQUM5QixDQUFDO3dCQUNELEVBQUUsRUFBRSxNQUFNLENBQUMsQ0FBQyxFQUFFLE1BQU0sS0FBSyxNQUFNLENBQUMsU0FBUyxFQUFFLENBQUM7NEJBQzFDLEVBQU8sQUFBUCxLQUFPO2tDQUNELE9BQU8sQ0FBQyxNQUFNLENBQUMsTUFBTTt3QkFDN0IsQ0FBQyxNQUFNLENBQUM7NEJBQ04sRUFBUyxBQUFULE9BQVM7a0NBQ0gsTUFBTTt3QkFDZCxDQUFDO3dCQUNELE1BQU0sR0FBRyxDQUFDLENBQUM7d0JBQ1gsY0FBYyxHQUFHLENBQUM7b0JBQ3BCLENBQUM7b0JBQ0QsS0FBSztnQkFDUCxJQUFJLENBQUMsTUFBTSxDQUFDLEtBQUs7b0JBQUUsQ0FBQzt3QkFDbEIsRUFBeUIsQUFBekIsdUJBQXlCO3dCQUN6QixLQUFLLENBQUMsSUFBSSxHQUFJLEtBQUssQ0FBQyxPQUFPLENBQUMsQ0FBQyxLQUFLLENBQUMsR0FBSSxLQUFLLENBQUMsT0FBTyxDQUFDLENBQUM7d0JBQ3RELEtBQUssQ0FBQyxNQUFNLEdBQUcsT0FBTyxDQUFDLE1BQU0sQ0FDM0IsS0FBSyxDQUFDLE9BQU8sQ0FBQyxRQUFRLENBQUMsQ0FBQyxFQUFFLEtBQUssQ0FBQyxPQUFPLENBQUMsTUFBTTt3QkFFaEQsS0FBSyxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsSUFBSSxFQUFFLE1BQU07OEJBQ3ZCLENBQUM7NEJBQUMsSUFBSTs0QkFBRSxNQUFNO3dCQUFDLENBQUM7d0JBQ3RCLE1BQU07b0JBQ1IsQ0FBQztnQkFDRCxJQUFJLENBQUMsTUFBTSxDQUFDLElBQUk7b0JBQ2QsS0FBSyxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsQ0FBQzt3QkFDbEIsTUFBTSxFQUFFLE1BQU0sQ0FBQyxJQUFJO3dCQUNuQixPQUFPLEVBQUUsS0FBSyxDQUFDLE9BQU87d0JBQ3RCLFdBQVcsRUFBRSxJQUFJO29CQUNuQixDQUFDOzBCQUNLLENBQUM7d0JBQUEsQ0FBTTt3QkFBRSxLQUFLLENBQUMsT0FBTztvQkFBQSxDQUFDO29CQUM3QixLQUFLO2dCQUNQLElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSTswQkFDUixDQUFDO3dCQUFBLENBQU07d0JBQUUsS0FBSyxDQUFDLE9BQU87b0JBQUEsQ0FBQztvQkFDN0IsS0FBSzs7O1FBR1gsQ0FBQztJQUNILENBQUM7SUFFTyxPQUFPLEdBQVMsQ0FBQztRQUN2QixLQUFLLEVBQUUsS0FBSyxJQUFJLElBQUksQ0FBQyxTQUFTO1FBQzlCLEVBQUUsR0FBRyxLQUFLLEVBQUUsTUFBTTtRQUNsQixFQUFFLEVBQUUsSUFBSSxDQUFDLFNBQVMsRUFBRSxNQUFNO1FBQzFCLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFFLEtBQUssRUFBQyxDQUFDLEdBQUcsS0FBSztRQUMxQixVQUFVLENBQUMsS0FBSyxFQUFFLElBQUksQ0FBQyxTQUFTLEVBQzdCLElBQUksS0FBTyxDQUFDLENBQUMsT0FBTztVQUNwQixLQUFLLEVBQUUsQ0FBQyxHQUFLLENBQUMsQ0FBQyxNQUFNLENBQUMsQ0FBQztVQUN2QixPQUFPLEtBQU8sQ0FBQztZQUNkLElBQUksQ0FBQyxTQUFTLENBQUMsS0FBSztZQUNwQixJQUFJLENBQUMsT0FBTztRQUNkLENBQUM7SUFDTCxDQUFDO0lBRU8sT0FBTyxDQUFDLEtBQXFCLEVBQWlCLENBQUM7UUFDckQsRUFBRSxFQUFFLElBQUksQ0FBQyxTQUFTLEVBQUUsQ0FBQztZQUNuQixLQUFLLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsZUFBZSxDQUFDLENBQWdDO1FBQ3hFLENBQUM7UUFDRCxLQUFLLENBQUMsQ0FBQyxHQUFHLFFBQVE7UUFDbEIsSUFBSSxDQUFDLFNBQVMsQ0FBQyxJQUFJLENBQUMsQ0FBQztZQUFDLENBQUM7WUFBRSxLQUFLO1FBQUMsQ0FBQztRQUNoQyxFQUFFLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQyxNQUFNLEtBQUssQ0FBQyxFQUFFLENBQUM7WUFDaEMsSUFBSSxDQUFDLE9BQU87UUFDZCxDQUFDO1FBQ0QsTUFBTSxDQUFDLENBQUM7SUFDVixDQUFDO0lBRUQsSUFBSSxDQUFDLElBQXNCLEVBQWlCLENBQUM7UUFDM0MsS0FBSyxDQUFDLE1BQU0sR0FBRyxNQUFNLENBQUMsSUFBSSxLQUFLLENBQVEsVUFDbkMsTUFBTSxDQUFDLFNBQVMsR0FDaEIsTUFBTSxDQUFDLFdBQVc7UUFDdEIsS0FBSyxDQUFDLE9BQU8sR0FBRyxNQUFNLENBQUMsSUFBSSxLQUFLLENBQVEsVUFDcEMsR0FBRyxDQUFDLFdBQVcsR0FBRyxNQUFNLENBQUMsSUFBSSxJQUM3QixJQUFJO1FBQ1IsS0FBSyxDQUFDLFdBQVcsR0FBRyxJQUFJO1FBQ3hCLEtBQUssQ0FBQyxLQUFLLEdBQUcsQ0FBQztZQUNiLFdBQVc7WUFDWCxNQUFNO1lBQ04sT0FBTztZQUNQLElBQUksRUFBRSxJQUFJLENBQUMsSUFBSTtRQUNqQixDQUFDO1FBQ0QsTUFBTSxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsS0FBSztJQUMzQixDQUFDO0lBRUQsSUFBSSxDQUFDLElBQXNCLEdBQUcsQ0FBRSxHQUFpQixDQUFDO1FBQ2hELEtBQUssQ0FBQyxPQUFPLEdBQUcsTUFBTSxDQUFDLElBQUksS0FBSyxDQUFRLFVBQ3BDLEdBQUcsQ0FBQyxXQUFXLEdBQUcsTUFBTSxDQUFDLElBQUksSUFDN0IsSUFBSTtRQUNSLEtBQUssQ0FBQyxLQUFLLEdBQUcsQ0FBQztZQUNiLFdBQVcsRUFBRSxJQUFJO1lBQ2pCLE1BQU0sRUFBRSxNQUFNLENBQUMsSUFBSTtZQUNuQixJQUFJLEVBQUUsSUFBSSxDQUFDLElBQUk7WUFDZixPQUFPO1FBQ1QsQ0FBQztRQUNELE1BQU0sQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLEtBQUs7SUFDM0IsQ0FBQztJQUVPLFNBQVMsR0FBRyxLQUFLO1FBQ3JCLFFBQVEsR0FBWSxDQUFDO1FBQ3ZCLE1BQU0sQ0FBQyxJQUFJLENBQUMsU0FBUztJQUN2QixDQUFDO1VBRUssS0FBSyxDQUFDLElBQUksR0FBRyxJQUFJLEVBQUUsTUFBZSxFQUFFLENBQUM7UUFDekMsR0FBRyxDQUFDLENBQUM7WUFDSCxLQUFLLENBQUMsTUFBTSxHQUFHLENBQUM7Z0JBQUEsSUFBSSxLQUFLLENBQUM7Z0JBQUUsSUFBSSxHQUFHLEdBQU07WUFBQSxDQUFDO1lBQzFDLEdBQUcsQ0FBQyxPQUFPO1lBQ1gsRUFBRSxFQUFFLE1BQU0sRUFBRSxDQUFDO2dCQUNYLEtBQUssQ0FBQyxXQUFXLEdBQUcsR0FBRyxDQUFDLFdBQVcsR0FBRyxNQUFNLENBQUMsTUFBTTtnQkFDbkQsT0FBTyxHQUFHLEdBQUcsQ0FBQyxVQUFVLENBQUMsQ0FBQyxHQUFHLFdBQVcsQ0FBQyxVQUFVO2dCQUNuRCxPQUFPLENBQUMsR0FBRyxDQUFDLE1BQU07Z0JBQ2xCLE9BQU8sQ0FBQyxHQUFHLENBQUMsV0FBVyxFQUFFLENBQUM7WUFDNUIsQ0FBQyxNQUFNLENBQUM7Z0JBQ04sT0FBTyxHQUFHLEdBQUcsQ0FBQyxVQUFVLENBQUMsTUFBTTtZQUNqQyxDQUFDO1lBQ0QsS0FBSyxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsQ0FBQztnQkFDbEIsV0FBVyxFQUFFLElBQUk7Z0JBQ2pCLE1BQU0sRUFBRSxNQUFNLENBQUMsS0FBSztnQkFDcEIsSUFBSSxFQUFFLElBQUksQ0FBQyxJQUFJO2dCQUNmLE9BQU87WUFDVCxDQUFDO1FBQ0gsQ0FBQyxDQUFDLEtBQUssRUFBRSxDQUFDLEVBQUUsQ0FBQztZQUNYLEtBQUssQ0FBQyxDQUFDO1FBQ1QsQ0FBQyxRQUFTLENBQUM7WUFDVCxJQUFJLENBQUMsa0JBQWtCO1FBQ3pCLENBQUM7SUFDSCxDQUFDO0lBRUQsVUFBVSxHQUFTLENBQUM7UUFDbEIsSUFBSSxDQUFDLGtCQUFrQjtJQUN6QixDQUFDO0lBRU8sa0JBQWtCLEdBQVMsQ0FBQztRQUNsQyxFQUFFLEVBQUUsSUFBSSxDQUFDLFFBQVEsRUFBRSxNQUFNO1FBQ3pCLEdBQUcsQ0FBQyxDQUFDO1lBQ0gsSUFBSSxDQUFDLElBQUksQ0FBQyxLQUFLO1FBQ2pCLENBQUMsQ0FBQyxLQUFLLEVBQUUsQ0FBQyxFQUFFLENBQUM7WUFDWCxPQUFPLENBQUMsS0FBSyxDQUFDLENBQUM7UUFDakIsQ0FBQyxRQUFTLENBQUM7WUFDVCxJQUFJLENBQUMsU0FBUyxHQUFHLElBQUk7WUFDckIsS0FBSyxDQUFDLElBQUksR0FBRyxJQUFJLENBQUMsU0FBUztZQUMzQixJQUFJLENBQUMsU0FBUyxHQUFHLENBQUMsQ0FBQztZQUNuQixJQUFJLENBQUMsT0FBTyxFQUFFLENBQUMsR0FDYixDQUFDLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FDUixHQUFHLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxlQUFlLENBQUMsQ0FBZ0M7O1FBR3RFLENBQUM7SUFDSCxDQUFDOztBQUdILEVBQWdGLEFBQWhGLDRFQUFnRixBQUFoRixFQUFnRixDQUNoRixNQUFNLFVBQVUsVUFBVSxDQUFDLEdBQXlCLEVBQVcsQ0FBQztJQUM5RCxLQUFLLENBQUMsT0FBTyxHQUFHLEdBQUcsQ0FBQyxPQUFPLENBQUMsR0FBRyxDQUFDLENBQVM7SUFDekMsRUFBRSxHQUFHLE9BQU8sSUFBSSxPQUFPLENBQUMsV0FBVyxPQUFPLENBQVcsWUFBRSxDQUFDO1FBQ3RELE1BQU0sQ0FBQyxLQUFLO0lBQ2QsQ0FBQztJQUNELEtBQUssQ0FBQyxNQUFNLEdBQUcsR0FBRyxDQUFDLE9BQU8sQ0FBQyxHQUFHLENBQUMsQ0FBbUI7SUFDbEQsTUFBTSxDQUNKLEdBQUcsQ0FBQyxPQUFPLENBQUMsR0FBRyxDQUFDLENBQW1CLHVCQUNuQyxNQUFNLENBQUMsTUFBTSxLQUFLLENBQVEsV0FDMUIsTUFBTSxDQUFDLE1BQU0sR0FBRyxDQUFDO0FBRXJCLENBQUM7QUFFRCxLQUFLLENBQUMsS0FBSyxHQUFHLENBQXNDO0FBRXBELEVBQXVFLEFBQXZFLG1FQUF1RSxBQUF2RSxFQUF1RSxDQUN2RSxNQUFNLFVBQVUsZUFBZSxDQUFDLEtBQWEsRUFBVSxDQUFDO0lBQ3RELEtBQUssQ0FBQyxJQUFJLEdBQUcsR0FBRyxDQUFDLElBQUk7SUFDckIsSUFBSSxDQUFDLE1BQU0sQ0FBQyxLQUFLLEdBQUcsS0FBSztJQUN6QixLQUFLLENBQUMsS0FBSyxHQUFHLElBQUksQ0FBQyxNQUFNO0lBQ3pCLE1BQU0sQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLFlBQVksSUFBSSxLQUFLO0FBQzFDLENBQUM7QUFFRCxFQUFpRSxBQUFqRSw2REFBaUUsQUFBakUsRUFBaUUsQ0FDakUsTUFBTSxnQkFBZ0IsZUFBZSxDQUFDLEdBS3JDLEVBQXNCLENBQUM7SUFDdEIsS0FBSyxDQUFDLENBQUMsQ0FBQyxJQUFJLEdBQUUsT0FBTyxHQUFFLFNBQVMsR0FBRSxTQUFTLEVBQUMsQ0FBQyxHQUFHLEdBQUc7SUFDbkQsRUFBRSxFQUFFLFVBQVUsQ0FBQyxHQUFHLEdBQUcsQ0FBQztRQUNwQixLQUFLLENBQUMsSUFBSSxHQUFHLEdBQUcsQ0FBQyxhQUFhLENBQUMsQ0FBQztZQUFDLElBQUk7WUFBRSxTQUFTO1lBQUUsU0FBUztRQUFDLENBQUM7UUFDN0QsS0FBSyxDQUFDLE1BQU0sR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLENBQW1CO1FBQzlDLEVBQUUsRUFBRSxNQUFNLENBQUMsTUFBTSxLQUFLLENBQVEsU0FBRSxDQUFDO1lBQy9CLEtBQUssQ0FBQyxHQUFHLENBQUMsS0FBSyxDQUFDLENBQW1DO1FBQ3JELENBQUM7UUFDRCxLQUFLLENBQUMsU0FBUyxHQUFHLGVBQWUsQ0FBQyxNQUFNO1FBQ3hDLEtBQUssQ0FBQyxVQUFVLEdBQUcsR0FBRyxDQUFDLE9BQU8sQ0FBQyxDQUFDO1lBQzlCLE9BQU8sRUFBRSxDQUFXO1lBQ3BCLFVBQVUsRUFBRSxDQUFTO1lBQ3JCLENBQXNCLHVCQUFFLFNBQVM7UUFDbkMsQ0FBQztRQUNELEtBQUssQ0FBQyxXQUFXLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxDQUF3QjtRQUN4RCxFQUFFLEVBQUUsTUFBTSxDQUFDLFdBQVcsS0FBSyxDQUFRLFNBQUUsQ0FBQztZQUNwQyxVQUFVLENBQUMsR0FBRyxDQUFDLENBQXdCLHlCQUFFLFdBQVc7UUFDdEQsQ0FBQztRQUNELEtBQUssQ0FBQyxVQUFVLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxDQUF1QjtRQUN0RCxFQUFFLEVBQUUsTUFBTSxDQUFDLFVBQVUsS0FBSyxDQUFRLFNBQUUsQ0FBQztZQUNuQyxVQUFVLENBQUMsR0FBRyxDQUFDLENBQXVCLHdCQUFFLFVBQVU7UUFDcEQsQ0FBQztRQUNELEtBQUssQ0FBQyxhQUFhLENBQUMsU0FBUyxFQUFFLENBQUM7WUFDOUIsTUFBTSxFQUFFLEdBQUc7WUFDWCxPQUFPLEVBQUUsVUFBVTtRQUNyQixDQUFDO1FBQ0QsTUFBTSxDQUFDLElBQUk7SUFDYixDQUFDO0lBQ0QsS0FBSyxDQUFDLEdBQUcsQ0FBQyxLQUFLLENBQUMsQ0FBMkI7QUFDN0MsQ0FBQztBQUVELEtBQUssQ0FBQyxTQUFTLEdBQUcsQ0FBMEQ7QUFFNUUsRUFBMkUsQUFBM0UsdUVBQTJFLEFBQTNFLEVBQTJFLENBQzNFLE1BQU0sVUFBVSxZQUFZLEdBQVcsQ0FBQztJQUN0QyxHQUFHLENBQUMsR0FBRyxHQUFHLENBQUU7SUFDWixHQUFHLENBQUUsR0FBRyxDQUFDLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxHQUFHLEVBQUUsRUFBRSxDQUFDLEdBQUksQ0FBQztRQUM1QixLQUFLLENBQUMsQ0FBQyxHQUFHLElBQUksQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLE1BQU0sS0FBSyxTQUFTLENBQUMsTUFBTTtRQUNyRCxHQUFHLElBQUksU0FBUyxDQUFDLENBQUM7SUFDcEIsQ0FBQztJQUNELE1BQU0sQ0FBQyxJQUFJLENBQUMsR0FBRztBQUNqQixDQUFDO0FBRUQsTUFBTSxnQkFBZ0IsU0FBUyxDQUM3QixHQUFRLEVBQ1IsT0FBZ0IsRUFDaEIsU0FBb0IsRUFDcEIsU0FBb0IsRUFDcEIsQ0FBQztJQUNELEtBQUssQ0FBQyxDQUFDLENBQUMsUUFBUSxHQUFFLFFBQVEsR0FBRSxNQUFNLEVBQUMsQ0FBQyxHQUFHLEdBQUc7SUFDMUMsS0FBSyxDQUFDLEdBQUcsR0FBRyxZQUFZO0lBRXhCLEVBQUUsR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLENBQU0sUUFBRyxDQUFDO1FBQ3pCLE9BQU8sQ0FBQyxHQUFHLENBQUMsQ0FBTSxPQUFFLFFBQVE7SUFDOUIsQ0FBQztJQUNELE9BQU8sQ0FBQyxHQUFHLENBQUMsQ0FBUyxVQUFFLENBQVc7SUFDbEMsT0FBTyxDQUFDLEdBQUcsQ0FBQyxDQUFZLGFBQUUsQ0FBUztJQUNuQyxPQUFPLENBQUMsR0FBRyxDQUFDLENBQW1CLG9CQUFFLEdBQUc7SUFDcEMsT0FBTyxDQUFDLEdBQUcsQ0FBQyxDQUF1Qix3QkFBRSxDQUFJO0lBRXpDLEdBQUcsQ0FBQyxTQUFTLElBQUksSUFBSSxFQUFFLFFBQVEsR0FBRyxNQUFNLENBQUMsYUFBYTtJQUN0RCxHQUFHLEVBQUUsS0FBSyxFQUFFLElBQUcsRUFBRSxLQUFLLEtBQUssT0FBTyxDQUFFLENBQUM7UUFDbkMsU0FBUyxPQUFPLElBQUcsQ0FBQyxFQUFFLEVBQUUsS0FBSyxDQUFDLElBQUk7SUFDcEMsQ0FBQztJQUNELFNBQVMsSUFBSSxDQUFNO0lBRW5CLEtBQUssQ0FBQyxTQUFTLENBQUMsS0FBSyxDQUFDLEdBQUcsQ0FBQyxXQUFXLEdBQUcsTUFBTSxDQUFDLFNBQVM7SUFDeEQsS0FBSyxDQUFDLFNBQVMsQ0FBQyxLQUFLO0lBRXJCLEtBQUssQ0FBQyxRQUFRLEdBQUcsR0FBRyxDQUFDLGVBQWUsQ0FBQyxTQUFTO0lBQzlDLEtBQUssQ0FBQyxVQUFVLEdBQUcsS0FBSyxDQUFDLFFBQVEsQ0FBQyxRQUFRO0lBQzFDLEVBQUUsRUFBRSxVQUFVLEtBQUssSUFBSSxFQUFFLENBQUM7UUFDeEIsS0FBSyxDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLGFBQWE7SUFDckMsQ0FBQztJQUNELEtBQUssQ0FBQyxDQUFDLEdBQUcsVUFBVSxDQUFDLEtBQUs7SUFDMUIsRUFBRSxHQUFHLENBQUMsRUFBRSxDQUFDO1FBQ1AsS0FBSyxDQUFDLEdBQUcsQ0FBQyxLQUFLLENBQUMsQ0FBMkIsNkJBQUcsVUFBVTtJQUMxRCxDQUFDO0lBRUQsTUFBTSxDQUFDLENBQUMsQ0FBQyxNQUFNO0lBQ2YsS0FBSyxDQUFDLENBQUMsQ0FBQyxPQUFPLEdBQUUsVUFBVSxFQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsTUFBTTtJQUN4QyxFQUFFLEVBQUUsT0FBTyxLQUFLLENBQVUsYUFBSSxVQUFVLEtBQUssQ0FBSyxNQUFFLENBQUM7UUFDbkQsS0FBSyxDQUFDLEdBQUcsQ0FBQyxLQUFLLEVBQ1osb0NBQW9DLEtBQ2xDLFFBQVEsRUFBRSxPQUFPLENBQUMsYUFBYSxFQUFFLFVBQVU7SUFFbEQsQ0FBQztJQUVELEtBQUssQ0FBQyxlQUFlLEdBQUcsS0FBSyxDQUFDLFFBQVEsQ0FBQyxjQUFjO0lBQ3JELEVBQUUsRUFBRSxlQUFlLEtBQUssSUFBSSxFQUFFLENBQUM7UUFDN0IsS0FBSyxDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLGFBQWE7SUFDckMsQ0FBQztJQUVELEtBQUssQ0FBQyxpQkFBaUIsR0FBRyxlQUFlLENBQUMsR0FBRztJQUM3QyxLQUFLLENBQUMsU0FBUyxHQUFHLGVBQWUsQ0FBQyxHQUFHLENBQUMsQ0FBc0I7SUFDNUQsRUFBRSxFQUFFLFNBQVMsS0FBSyxpQkFBaUIsRUFBRSxDQUFDO1FBQ3BDLEtBQUssQ0FBQyxHQUFHLENBQUMsS0FBSyxFQUNaLDRDQUE0QyxLQUMxQyxTQUFTLEVBQUUsaUJBQWlCLENBQUMsU0FBUyxFQUFFLFNBQVM7SUFFeEQsQ0FBQztBQUNILENBQUM7QUFFRCxNQUFNLFVBQVUsZUFBZSxDQUFDLE1BSy9CLEVBQWEsQ0FBQztJQUNiLE1BQU0sQ0FBQyxHQUFHLENBQUMsYUFBYSxDQUFDLE1BQU07QUFDakMsQ0FBQyJ9