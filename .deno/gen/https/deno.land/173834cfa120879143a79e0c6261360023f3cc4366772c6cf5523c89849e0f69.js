const HEX_CHARS = "0123456789abcdef".split("");
const EXTRA = [
    -2147483648,
    8388608,
    32768,
    128
];
const SHIFT = [
    24,
    16,
    8,
    0
];
const blocks = [];
export class Sha1 {
    #blocks;
    #block;
    #start;
    #bytes;
    #hBytes;
    #finalized;
    #hashed;
    #h0 = 1732584193;
    #h1 = 4023233417;
    #h2 = 2562383102;
    #h3 = 271733878;
    #h4 = 3285377520;
    #lastByteIndex = 0;
    constructor(sharedMemory = false){
        this.init(sharedMemory);
    }
    init(sharedMemory) {
        if (sharedMemory) {
            // deno-fmt-ignore
            blocks[0] = blocks[16] = blocks[1] = blocks[2] = blocks[3] = blocks[4] = blocks[5] = blocks[6] = blocks[7] = blocks[8] = blocks[9] = blocks[10] = blocks[11] = blocks[12] = blocks[13] = blocks[14] = blocks[15] = 0;
            this.#blocks = blocks;
        } else {
            this.#blocks = [
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                0
            ];
        }
        this.#h0 = 1732584193;
        this.#h1 = 4023233417;
        this.#h2 = 2562383102;
        this.#h3 = 271733878;
        this.#h4 = 3285377520;
        this.#block = this.#start = this.#bytes = this.#hBytes = 0;
        this.#finalized = this.#hashed = false;
    }
    update(message) {
        if (this.#finalized) {
            return this;
        }
        let msg;
        if (message instanceof ArrayBuffer) {
            msg = new Uint8Array(message);
        } else {
            msg = message;
        }
        let index = 0;
        const length = msg.length;
        const blocks = this.#blocks;
        while(index < length){
            let i;
            if (this.#hashed) {
                this.#hashed = false;
                blocks[0] = this.#block;
                // deno-fmt-ignore
                blocks[16] = blocks[1] = blocks[2] = blocks[3] = blocks[4] = blocks[5] = blocks[6] = blocks[7] = blocks[8] = blocks[9] = blocks[10] = blocks[11] = blocks[12] = blocks[13] = blocks[14] = blocks[15] = 0;
            }
            if (typeof msg !== "string") {
                for(i = this.#start; index < length && i < 64; ++index){
                    blocks[i >> 2] |= msg[index] << SHIFT[(i++) & 3];
                }
            } else {
                for(i = this.#start; index < length && i < 64; ++index){
                    let code = msg.charCodeAt(index);
                    if (code < 128) {
                        blocks[i >> 2] |= code << SHIFT[(i++) & 3];
                    } else if (code < 2048) {
                        blocks[i >> 2] |= (192 | code >> 6) << SHIFT[(i++) & 3];
                        blocks[i >> 2] |= (128 | code & 63) << SHIFT[(i++) & 3];
                    } else if (code < 55296 || code >= 57344) {
                        blocks[i >> 2] |= (224 | code >> 12) << SHIFT[(i++) & 3];
                        blocks[i >> 2] |= (128 | code >> 6 & 63) << SHIFT[(i++) & 3];
                        blocks[i >> 2] |= (128 | code & 63) << SHIFT[(i++) & 3];
                    } else {
                        code = 65536 + ((code & 1023) << 10 | msg.charCodeAt(++index) & 1023);
                        blocks[i >> 2] |= (240 | code >> 18) << SHIFT[(i++) & 3];
                        blocks[i >> 2] |= (128 | code >> 12 & 63) << SHIFT[(i++) & 3];
                        blocks[i >> 2] |= (128 | code >> 6 & 63) << SHIFT[(i++) & 3];
                        blocks[i >> 2] |= (128 | code & 63) << SHIFT[(i++) & 3];
                    }
                }
            }
            this.#lastByteIndex = i;
            this.#bytes += i - this.#start;
            if (i >= 64) {
                this.#block = blocks[16];
                this.#start = i - 64;
                this.hash();
                this.#hashed = true;
            } else {
                this.#start = i;
            }
        }
        if (this.#bytes > 4294967295) {
            this.#hBytes += this.#bytes / 4294967296 >>> 0;
            this.#bytes = this.#bytes >>> 0;
        }
        return this;
    }
    finalize() {
        if (this.#finalized) {
            return;
        }
        this.#finalized = true;
        const blocks = this.#blocks;
        const i = this.#lastByteIndex;
        blocks[16] = this.#block;
        blocks[i >> 2] |= EXTRA[i & 3];
        this.#block = blocks[16];
        if (i >= 56) {
            if (!this.#hashed) {
                this.hash();
            }
            blocks[0] = this.#block;
            // deno-fmt-ignore
            blocks[16] = blocks[1] = blocks[2] = blocks[3] = blocks[4] = blocks[5] = blocks[6] = blocks[7] = blocks[8] = blocks[9] = blocks[10] = blocks[11] = blocks[12] = blocks[13] = blocks[14] = blocks[15] = 0;
        }
        blocks[14] = this.#hBytes << 3 | this.#bytes >>> 29;
        blocks[15] = this.#bytes << 3;
        this.hash();
    }
    hash() {
        let a = this.#h0;
        let b = this.#h1;
        let c = this.#h2;
        let d = this.#h3;
        let e = this.#h4;
        let f;
        let j;
        let t;
        const blocks = this.#blocks;
        for(j = 16; j < 80; ++j){
            t = blocks[j - 3] ^ blocks[j - 8] ^ blocks[j - 14] ^ blocks[j - 16];
            blocks[j] = t << 1 | t >>> 31;
        }
        for(j = 0; j < 20; j += 5){
            f = b & c | ~b & d;
            t = a << 5 | a >>> 27;
            e = t + f + e + 1518500249 + blocks[j] >>> 0;
            b = b << 30 | b >>> 2;
            f = a & b | ~a & c;
            t = e << 5 | e >>> 27;
            d = t + f + d + 1518500249 + blocks[j + 1] >>> 0;
            a = a << 30 | a >>> 2;
            f = e & a | ~e & b;
            t = d << 5 | d >>> 27;
            c = t + f + c + 1518500249 + blocks[j + 2] >>> 0;
            e = e << 30 | e >>> 2;
            f = d & e | ~d & a;
            t = c << 5 | c >>> 27;
            b = t + f + b + 1518500249 + blocks[j + 3] >>> 0;
            d = d << 30 | d >>> 2;
            f = c & d | ~c & e;
            t = b << 5 | b >>> 27;
            a = t + f + a + 1518500249 + blocks[j + 4] >>> 0;
            c = c << 30 | c >>> 2;
        }
        for(; j < 40; j += 5){
            f = b ^ c ^ d;
            t = a << 5 | a >>> 27;
            e = t + f + e + 1859775393 + blocks[j] >>> 0;
            b = b << 30 | b >>> 2;
            f = a ^ b ^ c;
            t = e << 5 | e >>> 27;
            d = t + f + d + 1859775393 + blocks[j + 1] >>> 0;
            a = a << 30 | a >>> 2;
            f = e ^ a ^ b;
            t = d << 5 | d >>> 27;
            c = t + f + c + 1859775393 + blocks[j + 2] >>> 0;
            e = e << 30 | e >>> 2;
            f = d ^ e ^ a;
            t = c << 5 | c >>> 27;
            b = t + f + b + 1859775393 + blocks[j + 3] >>> 0;
            d = d << 30 | d >>> 2;
            f = c ^ d ^ e;
            t = b << 5 | b >>> 27;
            a = t + f + a + 1859775393 + blocks[j + 4] >>> 0;
            c = c << 30 | c >>> 2;
        }
        for(; j < 60; j += 5){
            f = b & c | b & d | c & d;
            t = a << 5 | a >>> 27;
            e = t + f + e - 1894007588 + blocks[j] >>> 0;
            b = b << 30 | b >>> 2;
            f = a & b | a & c | b & c;
            t = e << 5 | e >>> 27;
            d = t + f + d - 1894007588 + blocks[j + 1] >>> 0;
            a = a << 30 | a >>> 2;
            f = e & a | e & b | a & b;
            t = d << 5 | d >>> 27;
            c = t + f + c - 1894007588 + blocks[j + 2] >>> 0;
            e = e << 30 | e >>> 2;
            f = d & e | d & a | e & a;
            t = c << 5 | c >>> 27;
            b = t + f + b - 1894007588 + blocks[j + 3] >>> 0;
            d = d << 30 | d >>> 2;
            f = c & d | c & e | d & e;
            t = b << 5 | b >>> 27;
            a = t + f + a - 1894007588 + blocks[j + 4] >>> 0;
            c = c << 30 | c >>> 2;
        }
        for(; j < 80; j += 5){
            f = b ^ c ^ d;
            t = a << 5 | a >>> 27;
            e = t + f + e - 899497514 + blocks[j] >>> 0;
            b = b << 30 | b >>> 2;
            f = a ^ b ^ c;
            t = e << 5 | e >>> 27;
            d = t + f + d - 899497514 + blocks[j + 1] >>> 0;
            a = a << 30 | a >>> 2;
            f = e ^ a ^ b;
            t = d << 5 | d >>> 27;
            c = t + f + c - 899497514 + blocks[j + 2] >>> 0;
            e = e << 30 | e >>> 2;
            f = d ^ e ^ a;
            t = c << 5 | c >>> 27;
            b = t + f + b - 899497514 + blocks[j + 3] >>> 0;
            d = d << 30 | d >>> 2;
            f = c ^ d ^ e;
            t = b << 5 | b >>> 27;
            a = t + f + a - 899497514 + blocks[j + 4] >>> 0;
            c = c << 30 | c >>> 2;
        }
        this.#h0 = this.#h0 + a >>> 0;
        this.#h1 = this.#h1 + b >>> 0;
        this.#h2 = this.#h2 + c >>> 0;
        this.#h3 = this.#h3 + d >>> 0;
        this.#h4 = this.#h4 + e >>> 0;
    }
    hex() {
        this.finalize();
        const h0 = this.#h0;
        const h1 = this.#h1;
        const h2 = this.#h2;
        const h3 = this.#h3;
        const h4 = this.#h4;
        return HEX_CHARS[h0 >> 28 & 15] + HEX_CHARS[h0 >> 24 & 15] + HEX_CHARS[h0 >> 20 & 15] + HEX_CHARS[h0 >> 16 & 15] + HEX_CHARS[h0 >> 12 & 15] + HEX_CHARS[h0 >> 8 & 15] + HEX_CHARS[h0 >> 4 & 15] + HEX_CHARS[h0 & 15] + HEX_CHARS[h1 >> 28 & 15] + HEX_CHARS[h1 >> 24 & 15] + HEX_CHARS[h1 >> 20 & 15] + HEX_CHARS[h1 >> 16 & 15] + HEX_CHARS[h1 >> 12 & 15] + HEX_CHARS[h1 >> 8 & 15] + HEX_CHARS[h1 >> 4 & 15] + HEX_CHARS[h1 & 15] + HEX_CHARS[h2 >> 28 & 15] + HEX_CHARS[h2 >> 24 & 15] + HEX_CHARS[h2 >> 20 & 15] + HEX_CHARS[h2 >> 16 & 15] + HEX_CHARS[h2 >> 12 & 15] + HEX_CHARS[h2 >> 8 & 15] + HEX_CHARS[h2 >> 4 & 15] + HEX_CHARS[h2 & 15] + HEX_CHARS[h3 >> 28 & 15] + HEX_CHARS[h3 >> 24 & 15] + HEX_CHARS[h3 >> 20 & 15] + HEX_CHARS[h3 >> 16 & 15] + HEX_CHARS[h3 >> 12 & 15] + HEX_CHARS[h3 >> 8 & 15] + HEX_CHARS[h3 >> 4 & 15] + HEX_CHARS[h3 & 15] + HEX_CHARS[h4 >> 28 & 15] + HEX_CHARS[h4 >> 24 & 15] + HEX_CHARS[h4 >> 20 & 15] + HEX_CHARS[h4 >> 16 & 15] + HEX_CHARS[h4 >> 12 & 15] + HEX_CHARS[h4 >> 8 & 15] + HEX_CHARS[h4 >> 4 & 15] + HEX_CHARS[h4 & 15];
    }
    toString() {
        return this.hex();
    }
    digest() {
        this.finalize();
        const h0 = this.#h0;
        const h1 = this.#h1;
        const h2 = this.#h2;
        const h3 = this.#h3;
        const h4 = this.#h4;
        return [
            h0 >> 24 & 255,
            h0 >> 16 & 255,
            h0 >> 8 & 255,
            h0 & 255,
            h1 >> 24 & 255,
            h1 >> 16 & 255,
            h1 >> 8 & 255,
            h1 & 255,
            h2 >> 24 & 255,
            h2 >> 16 & 255,
            h2 >> 8 & 255,
            h2 & 255,
            h3 >> 24 & 255,
            h3 >> 16 & 255,
            h3 >> 8 & 255,
            h3 & 255,
            h4 >> 24 & 255,
            h4 >> 16 & 255,
            h4 >> 8 & 255,
            h4 & 255, 
        ];
    }
    array() {
        return this.digest();
    }
    arrayBuffer() {
        this.finalize();
        const buffer = new ArrayBuffer(20);
        const dataView = new DataView(buffer);
        dataView.setUint32(0, this.#h0);
        dataView.setUint32(4, this.#h1);
        dataView.setUint32(8, this.#h2);
        dataView.setUint32(12, this.#h3);
        dataView.setUint32(16, this.#h4);
        return buffer;
    }
}
export class HmacSha1 extends Sha1 {
    #sharedMemory;
    #inner;
    #oKeyPad;
    constructor(secretKey, sharedMemory = false){
        super(sharedMemory);
        let key;
        if (typeof secretKey === "string") {
            const bytes = [];
            const length = secretKey.length;
            let index = 0;
            for(let i = 0; i < length; i++){
                let code = secretKey.charCodeAt(i);
                if (code < 128) {
                    bytes[index++] = code;
                } else if (code < 2048) {
                    bytes[index++] = 192 | code >> 6;
                    bytes[index++] = 128 | code & 63;
                } else if (code < 55296 || code >= 57344) {
                    bytes[index++] = 224 | code >> 12;
                    bytes[index++] = 128 | code >> 6 & 63;
                    bytes[index++] = 128 | code & 63;
                } else {
                    code = 65536 + ((code & 1023) << 10 | secretKey.charCodeAt(++i) & 1023);
                    bytes[index++] = 240 | code >> 18;
                    bytes[index++] = 128 | code >> 12 & 63;
                    bytes[index++] = 128 | code >> 6 & 63;
                    bytes[index++] = 128 | code & 63;
                }
            }
            key = bytes;
        } else {
            if (secretKey instanceof ArrayBuffer) {
                key = new Uint8Array(secretKey);
            } else {
                key = secretKey;
            }
        }
        if (key.length > 64) {
            key = new Sha1(true).update(key).array();
        }
        const oKeyPad = [];
        const iKeyPad = [];
        for(let i = 0; i < 64; i++){
            const b = key[i] || 0;
            oKeyPad[i] = 92 ^ b;
            iKeyPad[i] = 54 ^ b;
        }
        this.update(iKeyPad);
        this.#oKeyPad = oKeyPad;
        this.#inner = true;
        this.#sharedMemory = sharedMemory;
    }
    finalize() {
        super.finalize();
        if (this.#inner) {
            this.#inner = false;
            const innerHash = this.array();
            super.init(this.#sharedMemory);
            this.update(this.#oKeyPad);
            this.update(innerHash);
            super.finalize();
        }
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbImh0dHBzOi8vZGVuby5sYW5kL3N0ZEAwLjk2LjAvaGFzaC9zaGExLnRzIl0sInNvdXJjZXNDb250ZW50IjpbIi8vIENvcHlyaWdodCAyMDE4LTIwMjEgdGhlIERlbm8gYXV0aG9ycy4gQWxsIHJpZ2h0cyByZXNlcnZlZC4gTUlUIGxpY2Vuc2UuXG4vKlxuICogW2pzLXNoYTFde0BsaW5rIGh0dHBzOi8vZ2l0aHViLmNvbS9lbW4xNzgvanMtc2hhMX1cbiAqXG4gKiBAdmVyc2lvbiAwLjYuMFxuICogQGF1dGhvciBDaGVuLCBZaS1DeXVhbiBbZW1uMTc4QGdtYWlsLmNvbV1cbiAqIEBjb3B5cmlnaHQgQ2hlbiwgWWktQ3l1YW4gMjAxNC0yMDE3XG4gKiBAbGljZW5zZSBNSVRcbiAqL1xuXG5leHBvcnQgdHlwZSBNZXNzYWdlID0gc3RyaW5nIHwgbnVtYmVyW10gfCBBcnJheUJ1ZmZlcjtcblxuY29uc3QgSEVYX0NIQVJTID0gXCIwMTIzNDU2Nzg5YWJjZGVmXCIuc3BsaXQoXCJcIik7XG5jb25zdCBFWFRSQSA9IFstMjE0NzQ4MzY0OCwgODM4ODYwOCwgMzI3NjgsIDEyOF0gYXMgY29uc3Q7XG5jb25zdCBTSElGVCA9IFsyNCwgMTYsIDgsIDBdIGFzIGNvbnN0O1xuXG5jb25zdCBibG9ja3M6IG51bWJlcltdID0gW107XG5cbmV4cG9ydCBjbGFzcyBTaGExIHtcbiAgI2Jsb2NrcyE6IG51bWJlcltdO1xuICAjYmxvY2shOiBudW1iZXI7XG4gICNzdGFydCE6IG51bWJlcjtcbiAgI2J5dGVzITogbnVtYmVyO1xuICAjaEJ5dGVzITogbnVtYmVyO1xuICAjZmluYWxpemVkITogYm9vbGVhbjtcbiAgI2hhc2hlZCE6IGJvb2xlYW47XG5cbiAgI2gwID0gMHg2NzQ1MjMwMTtcbiAgI2gxID0gMHhlZmNkYWI4OTtcbiAgI2gyID0gMHg5OGJhZGNmZTtcbiAgI2gzID0gMHgxMDMyNTQ3NjtcbiAgI2g0ID0gMHhjM2QyZTFmMDtcbiAgI2xhc3RCeXRlSW5kZXggPSAwO1xuXG4gIGNvbnN0cnVjdG9yKHNoYXJlZE1lbW9yeSA9IGZhbHNlKSB7XG4gICAgdGhpcy5pbml0KHNoYXJlZE1lbW9yeSk7XG4gIH1cbiAgcHJvdGVjdGVkIGluaXQoc2hhcmVkTWVtb3J5OiBib29sZWFuKSB7XG4gICAgaWYgKHNoYXJlZE1lbW9yeSkge1xuICAgICAgLy8gZGVuby1mbXQtaWdub3JlXG4gICAgICBibG9ja3NbMF0gPSBibG9ja3NbMTZdID0gYmxvY2tzWzFdID0gYmxvY2tzWzJdID0gYmxvY2tzWzNdID0gYmxvY2tzWzRdID0gYmxvY2tzWzVdID0gYmxvY2tzWzZdID0gYmxvY2tzWzddID0gYmxvY2tzWzhdID0gYmxvY2tzWzldID0gYmxvY2tzWzEwXSA9IGJsb2Nrc1sxMV0gPSBibG9ja3NbMTJdID0gYmxvY2tzWzEzXSA9IGJsb2Nrc1sxNF0gPSBibG9ja3NbMTVdID0gMDtcbiAgICAgIHRoaXMuI2Jsb2NrcyA9IGJsb2NrcztcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy4jYmxvY2tzID0gWzAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDBdO1xuICAgIH1cblxuICAgIHRoaXMuI2gwID0gMHg2NzQ1MjMwMTtcbiAgICB0aGlzLiNoMSA9IDB4ZWZjZGFiODk7XG4gICAgdGhpcy4jaDIgPSAweDk4YmFkY2ZlO1xuICAgIHRoaXMuI2gzID0gMHgxMDMyNTQ3NjtcbiAgICB0aGlzLiNoNCA9IDB4YzNkMmUxZjA7XG5cbiAgICB0aGlzLiNibG9jayA9IHRoaXMuI3N0YXJ0ID0gdGhpcy4jYnl0ZXMgPSB0aGlzLiNoQnl0ZXMgPSAwO1xuICAgIHRoaXMuI2ZpbmFsaXplZCA9IHRoaXMuI2hhc2hlZCA9IGZhbHNlO1xuICB9XG4gIHVwZGF0ZShtZXNzYWdlOiBNZXNzYWdlKTogdGhpcyB7XG4gICAgaWYgKHRoaXMuI2ZpbmFsaXplZCkge1xuICAgICAgcmV0dXJuIHRoaXM7XG4gICAgfVxuXG4gICAgbGV0IG1zZzogc3RyaW5nIHwgbnVtYmVyW10gfCBVaW50OEFycmF5IHwgdW5kZWZpbmVkO1xuICAgIGlmIChtZXNzYWdlIGluc3RhbmNlb2YgQXJyYXlCdWZmZXIpIHtcbiAgICAgIG1zZyA9IG5ldyBVaW50OEFycmF5KG1lc3NhZ2UpO1xuICAgIH0gZWxzZSB7XG4gICAgICBtc2cgPSBtZXNzYWdlO1xuICAgIH1cblxuICAgIGxldCBpbmRleCA9IDA7XG4gICAgY29uc3QgbGVuZ3RoID0gbXNnLmxlbmd0aDtcbiAgICBjb25zdCBibG9ja3MgPSB0aGlzLiNibG9ja3M7XG5cbiAgICB3aGlsZSAoaW5kZXggPCBsZW5ndGgpIHtcbiAgICAgIGxldCBpOiBudW1iZXI7XG4gICAgICBpZiAodGhpcy4jaGFzaGVkKSB7XG4gICAgICAgIHRoaXMuI2hhc2hlZCA9IGZhbHNlO1xuICAgICAgICBibG9ja3NbMF0gPSB0aGlzLiNibG9jaztcbiAgICAgICAgLy8gZGVuby1mbXQtaWdub3JlXG4gICAgICAgIGJsb2Nrc1sxNl0gPSBibG9ja3NbMV0gPSBibG9ja3NbMl0gPSBibG9ja3NbM10gPSBibG9ja3NbNF0gPSBibG9ja3NbNV0gPSBibG9ja3NbNl0gPSBibG9ja3NbN10gPSBibG9ja3NbOF0gPSBibG9ja3NbOV0gPSBibG9ja3NbMTBdID0gYmxvY2tzWzExXSA9IGJsb2Nrc1sxMl0gPSBibG9ja3NbMTNdID0gYmxvY2tzWzE0XSA9IGJsb2Nrc1sxNV0gPSAwO1xuICAgICAgfVxuXG4gICAgICBpZiAodHlwZW9mIG1zZyAhPT0gXCJzdHJpbmdcIikge1xuICAgICAgICBmb3IgKGkgPSB0aGlzLiNzdGFydDsgaW5kZXggPCBsZW5ndGggJiYgaSA8IDY0OyArK2luZGV4KSB7XG4gICAgICAgICAgYmxvY2tzW2kgPj4gMl0gfD0gbXNnW2luZGV4XSA8PCBTSElGVFtpKysgJiAzXTtcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgZm9yIChpID0gdGhpcy4jc3RhcnQ7IGluZGV4IDwgbGVuZ3RoICYmIGkgPCA2NDsgKytpbmRleCkge1xuICAgICAgICAgIGxldCBjb2RlID0gbXNnLmNoYXJDb2RlQXQoaW5kZXgpO1xuICAgICAgICAgIGlmIChjb2RlIDwgMHg4MCkge1xuICAgICAgICAgICAgYmxvY2tzW2kgPj4gMl0gfD0gY29kZSA8PCBTSElGVFtpKysgJiAzXTtcbiAgICAgICAgICB9IGVsc2UgaWYgKGNvZGUgPCAweDgwMCkge1xuICAgICAgICAgICAgYmxvY2tzW2kgPj4gMl0gfD0gKDB4YzAgfCAoY29kZSA+PiA2KSkgPDwgU0hJRlRbaSsrICYgM107XG4gICAgICAgICAgICBibG9ja3NbaSA+PiAyXSB8PSAoMHg4MCB8IChjb2RlICYgMHgzZikpIDw8IFNISUZUW2krKyAmIDNdO1xuICAgICAgICAgIH0gZWxzZSBpZiAoY29kZSA8IDB4ZDgwMCB8fCBjb2RlID49IDB4ZTAwMCkge1xuICAgICAgICAgICAgYmxvY2tzW2kgPj4gMl0gfD0gKDB4ZTAgfCAoY29kZSA+PiAxMikpIDw8IFNISUZUW2krKyAmIDNdO1xuICAgICAgICAgICAgYmxvY2tzW2kgPj4gMl0gfD0gKDB4ODAgfCAoKGNvZGUgPj4gNikgJiAweDNmKSkgPDwgU0hJRlRbaSsrICYgM107XG4gICAgICAgICAgICBibG9ja3NbaSA+PiAyXSB8PSAoMHg4MCB8IChjb2RlICYgMHgzZikpIDw8IFNISUZUW2krKyAmIDNdO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBjb2RlID0gMHgxMDAwMCArXG4gICAgICAgICAgICAgICgoKGNvZGUgJiAweDNmZikgPDwgMTApIHwgKG1zZy5jaGFyQ29kZUF0KCsraW5kZXgpICYgMHgzZmYpKTtcbiAgICAgICAgICAgIGJsb2Nrc1tpID4+IDJdIHw9ICgweGYwIHwgKGNvZGUgPj4gMTgpKSA8PCBTSElGVFtpKysgJiAzXTtcbiAgICAgICAgICAgIGJsb2Nrc1tpID4+IDJdIHw9ICgweDgwIHwgKChjb2RlID4+IDEyKSAmIDB4M2YpKSA8PCBTSElGVFtpKysgJiAzXTtcbiAgICAgICAgICAgIGJsb2Nrc1tpID4+IDJdIHw9ICgweDgwIHwgKChjb2RlID4+IDYpICYgMHgzZikpIDw8IFNISUZUW2krKyAmIDNdO1xuICAgICAgICAgICAgYmxvY2tzW2kgPj4gMl0gfD0gKDB4ODAgfCAoY29kZSAmIDB4M2YpKSA8PCBTSElGVFtpKysgJiAzXTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgdGhpcy4jbGFzdEJ5dGVJbmRleCA9IGk7XG4gICAgICB0aGlzLiNieXRlcyArPSBpIC0gdGhpcy4jc3RhcnQ7XG4gICAgICBpZiAoaSA+PSA2NCkge1xuICAgICAgICB0aGlzLiNibG9jayA9IGJsb2Nrc1sxNl07XG4gICAgICAgIHRoaXMuI3N0YXJ0ID0gaSAtIDY0O1xuICAgICAgICB0aGlzLmhhc2goKTtcbiAgICAgICAgdGhpcy4jaGFzaGVkID0gdHJ1ZTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRoaXMuI3N0YXJ0ID0gaTtcbiAgICAgIH1cbiAgICB9XG4gICAgaWYgKHRoaXMuI2J5dGVzID4gNDI5NDk2NzI5NSkge1xuICAgICAgdGhpcy4jaEJ5dGVzICs9ICh0aGlzLiNieXRlcyAvIDQyOTQ5NjcyOTYpID4+PiAwO1xuICAgICAgdGhpcy4jYnl0ZXMgPSB0aGlzLiNieXRlcyA+Pj4gMDtcbiAgICB9XG4gICAgcmV0dXJuIHRoaXM7XG4gIH1cblxuICBwcm90ZWN0ZWQgZmluYWxpemUoKTogdm9pZCB7XG4gICAgaWYgKHRoaXMuI2ZpbmFsaXplZCkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICB0aGlzLiNmaW5hbGl6ZWQgPSB0cnVlO1xuICAgIGNvbnN0IGJsb2NrcyA9IHRoaXMuI2Jsb2NrcztcbiAgICBjb25zdCBpID0gdGhpcy4jbGFzdEJ5dGVJbmRleDtcbiAgICBibG9ja3NbMTZdID0gdGhpcy4jYmxvY2s7XG4gICAgYmxvY2tzW2kgPj4gMl0gfD0gRVhUUkFbaSAmIDNdO1xuICAgIHRoaXMuI2Jsb2NrID0gYmxvY2tzWzE2XTtcbiAgICBpZiAoaSA+PSA1Nikge1xuICAgICAgaWYgKCF0aGlzLiNoYXNoZWQpIHtcbiAgICAgICAgdGhpcy5oYXNoKCk7XG4gICAgICB9XG4gICAgICBibG9ja3NbMF0gPSB0aGlzLiNibG9jaztcbiAgICAgIC8vIGRlbm8tZm10LWlnbm9yZVxuICAgICAgYmxvY2tzWzE2XSA9IGJsb2Nrc1sxXSA9IGJsb2Nrc1syXSA9IGJsb2Nrc1szXSA9IGJsb2Nrc1s0XSA9IGJsb2Nrc1s1XSA9IGJsb2Nrc1s2XSA9IGJsb2Nrc1s3XSA9IGJsb2Nrc1s4XSA9IGJsb2Nrc1s5XSA9IGJsb2Nrc1sxMF0gPSBibG9ja3NbMTFdID0gYmxvY2tzWzEyXSA9IGJsb2Nrc1sxM10gPSBibG9ja3NbMTRdID0gYmxvY2tzWzE1XSA9IDA7XG4gICAgfVxuICAgIGJsb2Nrc1sxNF0gPSAodGhpcy4jaEJ5dGVzIDw8IDMpIHwgKHRoaXMuI2J5dGVzID4+PiAyOSk7XG4gICAgYmxvY2tzWzE1XSA9IHRoaXMuI2J5dGVzIDw8IDM7XG4gICAgdGhpcy5oYXNoKCk7XG4gIH1cblxuICBwcml2YXRlIGhhc2goKTogdm9pZCB7XG4gICAgbGV0IGEgPSB0aGlzLiNoMDtcbiAgICBsZXQgYiA9IHRoaXMuI2gxO1xuICAgIGxldCBjID0gdGhpcy4jaDI7XG4gICAgbGV0IGQgPSB0aGlzLiNoMztcbiAgICBsZXQgZSA9IHRoaXMuI2g0O1xuICAgIGxldCBmOiBudW1iZXI7XG4gICAgbGV0IGo6IG51bWJlcjtcbiAgICBsZXQgdDogbnVtYmVyO1xuICAgIGNvbnN0IGJsb2NrcyA9IHRoaXMuI2Jsb2NrcztcblxuICAgIGZvciAoaiA9IDE2OyBqIDwgODA7ICsraikge1xuICAgICAgdCA9IGJsb2Nrc1tqIC0gM10gXiBibG9ja3NbaiAtIDhdIF4gYmxvY2tzW2ogLSAxNF0gXiBibG9ja3NbaiAtIDE2XTtcbiAgICAgIGJsb2Nrc1tqXSA9ICh0IDw8IDEpIHwgKHQgPj4+IDMxKTtcbiAgICB9XG5cbiAgICBmb3IgKGogPSAwOyBqIDwgMjA7IGogKz0gNSkge1xuICAgICAgZiA9IChiICYgYykgfCAofmIgJiBkKTtcbiAgICAgIHQgPSAoYSA8PCA1KSB8IChhID4+PiAyNyk7XG4gICAgICBlID0gKHQgKyBmICsgZSArIDE1MTg1MDAyNDkgKyBibG9ja3Nbal0pID4+PiAwO1xuICAgICAgYiA9IChiIDw8IDMwKSB8IChiID4+PiAyKTtcblxuICAgICAgZiA9IChhICYgYikgfCAofmEgJiBjKTtcbiAgICAgIHQgPSAoZSA8PCA1KSB8IChlID4+PiAyNyk7XG4gICAgICBkID0gKHQgKyBmICsgZCArIDE1MTg1MDAyNDkgKyBibG9ja3NbaiArIDFdKSA+Pj4gMDtcbiAgICAgIGEgPSAoYSA8PCAzMCkgfCAoYSA+Pj4gMik7XG5cbiAgICAgIGYgPSAoZSAmIGEpIHwgKH5lICYgYik7XG4gICAgICB0ID0gKGQgPDwgNSkgfCAoZCA+Pj4gMjcpO1xuICAgICAgYyA9ICh0ICsgZiArIGMgKyAxNTE4NTAwMjQ5ICsgYmxvY2tzW2ogKyAyXSkgPj4+IDA7XG4gICAgICBlID0gKGUgPDwgMzApIHwgKGUgPj4+IDIpO1xuXG4gICAgICBmID0gKGQgJiBlKSB8ICh+ZCAmIGEpO1xuICAgICAgdCA9IChjIDw8IDUpIHwgKGMgPj4+IDI3KTtcbiAgICAgIGIgPSAodCArIGYgKyBiICsgMTUxODUwMDI0OSArIGJsb2Nrc1tqICsgM10pID4+PiAwO1xuICAgICAgZCA9IChkIDw8IDMwKSB8IChkID4+PiAyKTtcblxuICAgICAgZiA9IChjICYgZCkgfCAofmMgJiBlKTtcbiAgICAgIHQgPSAoYiA8PCA1KSB8IChiID4+PiAyNyk7XG4gICAgICBhID0gKHQgKyBmICsgYSArIDE1MTg1MDAyNDkgKyBibG9ja3NbaiArIDRdKSA+Pj4gMDtcbiAgICAgIGMgPSAoYyA8PCAzMCkgfCAoYyA+Pj4gMik7XG4gICAgfVxuXG4gICAgZm9yICg7IGogPCA0MDsgaiArPSA1KSB7XG4gICAgICBmID0gYiBeIGMgXiBkO1xuICAgICAgdCA9IChhIDw8IDUpIHwgKGEgPj4+IDI3KTtcbiAgICAgIGUgPSAodCArIGYgKyBlICsgMTg1OTc3NTM5MyArIGJsb2Nrc1tqXSkgPj4+IDA7XG4gICAgICBiID0gKGIgPDwgMzApIHwgKGIgPj4+IDIpO1xuXG4gICAgICBmID0gYSBeIGIgXiBjO1xuICAgICAgdCA9IChlIDw8IDUpIHwgKGUgPj4+IDI3KTtcbiAgICAgIGQgPSAodCArIGYgKyBkICsgMTg1OTc3NTM5MyArIGJsb2Nrc1tqICsgMV0pID4+PiAwO1xuICAgICAgYSA9IChhIDw8IDMwKSB8IChhID4+PiAyKTtcblxuICAgICAgZiA9IGUgXiBhIF4gYjtcbiAgICAgIHQgPSAoZCA8PCA1KSB8IChkID4+PiAyNyk7XG4gICAgICBjID0gKHQgKyBmICsgYyArIDE4NTk3NzUzOTMgKyBibG9ja3NbaiArIDJdKSA+Pj4gMDtcbiAgICAgIGUgPSAoZSA8PCAzMCkgfCAoZSA+Pj4gMik7XG5cbiAgICAgIGYgPSBkIF4gZSBeIGE7XG4gICAgICB0ID0gKGMgPDwgNSkgfCAoYyA+Pj4gMjcpO1xuICAgICAgYiA9ICh0ICsgZiArIGIgKyAxODU5Nzc1MzkzICsgYmxvY2tzW2ogKyAzXSkgPj4+IDA7XG4gICAgICBkID0gKGQgPDwgMzApIHwgKGQgPj4+IDIpO1xuXG4gICAgICBmID0gYyBeIGQgXiBlO1xuICAgICAgdCA9IChiIDw8IDUpIHwgKGIgPj4+IDI3KTtcbiAgICAgIGEgPSAodCArIGYgKyBhICsgMTg1OTc3NTM5MyArIGJsb2Nrc1tqICsgNF0pID4+PiAwO1xuICAgICAgYyA9IChjIDw8IDMwKSB8IChjID4+PiAyKTtcbiAgICB9XG5cbiAgICBmb3IgKDsgaiA8IDYwOyBqICs9IDUpIHtcbiAgICAgIGYgPSAoYiAmIGMpIHwgKGIgJiBkKSB8IChjICYgZCk7XG4gICAgICB0ID0gKGEgPDwgNSkgfCAoYSA+Pj4gMjcpO1xuICAgICAgZSA9ICh0ICsgZiArIGUgLSAxODk0MDA3NTg4ICsgYmxvY2tzW2pdKSA+Pj4gMDtcbiAgICAgIGIgPSAoYiA8PCAzMCkgfCAoYiA+Pj4gMik7XG5cbiAgICAgIGYgPSAoYSAmIGIpIHwgKGEgJiBjKSB8IChiICYgYyk7XG4gICAgICB0ID0gKGUgPDwgNSkgfCAoZSA+Pj4gMjcpO1xuICAgICAgZCA9ICh0ICsgZiArIGQgLSAxODk0MDA3NTg4ICsgYmxvY2tzW2ogKyAxXSkgPj4+IDA7XG4gICAgICBhID0gKGEgPDwgMzApIHwgKGEgPj4+IDIpO1xuXG4gICAgICBmID0gKGUgJiBhKSB8IChlICYgYikgfCAoYSAmIGIpO1xuICAgICAgdCA9IChkIDw8IDUpIHwgKGQgPj4+IDI3KTtcbiAgICAgIGMgPSAodCArIGYgKyBjIC0gMTg5NDAwNzU4OCArIGJsb2Nrc1tqICsgMl0pID4+PiAwO1xuICAgICAgZSA9IChlIDw8IDMwKSB8IChlID4+PiAyKTtcblxuICAgICAgZiA9IChkICYgZSkgfCAoZCAmIGEpIHwgKGUgJiBhKTtcbiAgICAgIHQgPSAoYyA8PCA1KSB8IChjID4+PiAyNyk7XG4gICAgICBiID0gKHQgKyBmICsgYiAtIDE4OTQwMDc1ODggKyBibG9ja3NbaiArIDNdKSA+Pj4gMDtcbiAgICAgIGQgPSAoZCA8PCAzMCkgfCAoZCA+Pj4gMik7XG5cbiAgICAgIGYgPSAoYyAmIGQpIHwgKGMgJiBlKSB8IChkICYgZSk7XG4gICAgICB0ID0gKGIgPDwgNSkgfCAoYiA+Pj4gMjcpO1xuICAgICAgYSA9ICh0ICsgZiArIGEgLSAxODk0MDA3NTg4ICsgYmxvY2tzW2ogKyA0XSkgPj4+IDA7XG4gICAgICBjID0gKGMgPDwgMzApIHwgKGMgPj4+IDIpO1xuICAgIH1cblxuICAgIGZvciAoOyBqIDwgODA7IGogKz0gNSkge1xuICAgICAgZiA9IGIgXiBjIF4gZDtcbiAgICAgIHQgPSAoYSA8PCA1KSB8IChhID4+PiAyNyk7XG4gICAgICBlID0gKHQgKyBmICsgZSAtIDg5OTQ5NzUxNCArIGJsb2Nrc1tqXSkgPj4+IDA7XG4gICAgICBiID0gKGIgPDwgMzApIHwgKGIgPj4+IDIpO1xuXG4gICAgICBmID0gYSBeIGIgXiBjO1xuICAgICAgdCA9IChlIDw8IDUpIHwgKGUgPj4+IDI3KTtcbiAgICAgIGQgPSAodCArIGYgKyBkIC0gODk5NDk3NTE0ICsgYmxvY2tzW2ogKyAxXSkgPj4+IDA7XG4gICAgICBhID0gKGEgPDwgMzApIHwgKGEgPj4+IDIpO1xuXG4gICAgICBmID0gZSBeIGEgXiBiO1xuICAgICAgdCA9IChkIDw8IDUpIHwgKGQgPj4+IDI3KTtcbiAgICAgIGMgPSAodCArIGYgKyBjIC0gODk5NDk3NTE0ICsgYmxvY2tzW2ogKyAyXSkgPj4+IDA7XG4gICAgICBlID0gKGUgPDwgMzApIHwgKGUgPj4+IDIpO1xuXG4gICAgICBmID0gZCBeIGUgXiBhO1xuICAgICAgdCA9IChjIDw8IDUpIHwgKGMgPj4+IDI3KTtcbiAgICAgIGIgPSAodCArIGYgKyBiIC0gODk5NDk3NTE0ICsgYmxvY2tzW2ogKyAzXSkgPj4+IDA7XG4gICAgICBkID0gKGQgPDwgMzApIHwgKGQgPj4+IDIpO1xuXG4gICAgICBmID0gYyBeIGQgXiBlO1xuICAgICAgdCA9IChiIDw8IDUpIHwgKGIgPj4+IDI3KTtcbiAgICAgIGEgPSAodCArIGYgKyBhIC0gODk5NDk3NTE0ICsgYmxvY2tzW2ogKyA0XSkgPj4+IDA7XG4gICAgICBjID0gKGMgPDwgMzApIHwgKGMgPj4+IDIpO1xuICAgIH1cblxuICAgIHRoaXMuI2gwID0gKHRoaXMuI2gwICsgYSkgPj4+IDA7XG4gICAgdGhpcy4jaDEgPSAodGhpcy4jaDEgKyBiKSA+Pj4gMDtcbiAgICB0aGlzLiNoMiA9ICh0aGlzLiNoMiArIGMpID4+PiAwO1xuICAgIHRoaXMuI2gzID0gKHRoaXMuI2gzICsgZCkgPj4+IDA7XG4gICAgdGhpcy4jaDQgPSAodGhpcy4jaDQgKyBlKSA+Pj4gMDtcbiAgfVxuXG4gIGhleCgpOiBzdHJpbmcge1xuICAgIHRoaXMuZmluYWxpemUoKTtcblxuICAgIGNvbnN0IGgwID0gdGhpcy4jaDA7XG4gICAgY29uc3QgaDEgPSB0aGlzLiNoMTtcbiAgICBjb25zdCBoMiA9IHRoaXMuI2gyO1xuICAgIGNvbnN0IGgzID0gdGhpcy4jaDM7XG4gICAgY29uc3QgaDQgPSB0aGlzLiNoNDtcblxuICAgIHJldHVybiAoXG4gICAgICBIRVhfQ0hBUlNbKGgwID4+IDI4KSAmIDB4MGZdICtcbiAgICAgIEhFWF9DSEFSU1soaDAgPj4gMjQpICYgMHgwZl0gK1xuICAgICAgSEVYX0NIQVJTWyhoMCA+PiAyMCkgJiAweDBmXSArXG4gICAgICBIRVhfQ0hBUlNbKGgwID4+IDE2KSAmIDB4MGZdICtcbiAgICAgIEhFWF9DSEFSU1soaDAgPj4gMTIpICYgMHgwZl0gK1xuICAgICAgSEVYX0NIQVJTWyhoMCA+PiA4KSAmIDB4MGZdICtcbiAgICAgIEhFWF9DSEFSU1soaDAgPj4gNCkgJiAweDBmXSArXG4gICAgICBIRVhfQ0hBUlNbaDAgJiAweDBmXSArXG4gICAgICBIRVhfQ0hBUlNbKGgxID4+IDI4KSAmIDB4MGZdICtcbiAgICAgIEhFWF9DSEFSU1soaDEgPj4gMjQpICYgMHgwZl0gK1xuICAgICAgSEVYX0NIQVJTWyhoMSA+PiAyMCkgJiAweDBmXSArXG4gICAgICBIRVhfQ0hBUlNbKGgxID4+IDE2KSAmIDB4MGZdICtcbiAgICAgIEhFWF9DSEFSU1soaDEgPj4gMTIpICYgMHgwZl0gK1xuICAgICAgSEVYX0NIQVJTWyhoMSA+PiA4KSAmIDB4MGZdICtcbiAgICAgIEhFWF9DSEFSU1soaDEgPj4gNCkgJiAweDBmXSArXG4gICAgICBIRVhfQ0hBUlNbaDEgJiAweDBmXSArXG4gICAgICBIRVhfQ0hBUlNbKGgyID4+IDI4KSAmIDB4MGZdICtcbiAgICAgIEhFWF9DSEFSU1soaDIgPj4gMjQpICYgMHgwZl0gK1xuICAgICAgSEVYX0NIQVJTWyhoMiA+PiAyMCkgJiAweDBmXSArXG4gICAgICBIRVhfQ0hBUlNbKGgyID4+IDE2KSAmIDB4MGZdICtcbiAgICAgIEhFWF9DSEFSU1soaDIgPj4gMTIpICYgMHgwZl0gK1xuICAgICAgSEVYX0NIQVJTWyhoMiA+PiA4KSAmIDB4MGZdICtcbiAgICAgIEhFWF9DSEFSU1soaDIgPj4gNCkgJiAweDBmXSArXG4gICAgICBIRVhfQ0hBUlNbaDIgJiAweDBmXSArXG4gICAgICBIRVhfQ0hBUlNbKGgzID4+IDI4KSAmIDB4MGZdICtcbiAgICAgIEhFWF9DSEFSU1soaDMgPj4gMjQpICYgMHgwZl0gK1xuICAgICAgSEVYX0NIQVJTWyhoMyA+PiAyMCkgJiAweDBmXSArXG4gICAgICBIRVhfQ0hBUlNbKGgzID4+IDE2KSAmIDB4MGZdICtcbiAgICAgIEhFWF9DSEFSU1soaDMgPj4gMTIpICYgMHgwZl0gK1xuICAgICAgSEVYX0NIQVJTWyhoMyA+PiA4KSAmIDB4MGZdICtcbiAgICAgIEhFWF9DSEFSU1soaDMgPj4gNCkgJiAweDBmXSArXG4gICAgICBIRVhfQ0hBUlNbaDMgJiAweDBmXSArXG4gICAgICBIRVhfQ0hBUlNbKGg0ID4+IDI4KSAmIDB4MGZdICtcbiAgICAgIEhFWF9DSEFSU1soaDQgPj4gMjQpICYgMHgwZl0gK1xuICAgICAgSEVYX0NIQVJTWyhoNCA+PiAyMCkgJiAweDBmXSArXG4gICAgICBIRVhfQ0hBUlNbKGg0ID4+IDE2KSAmIDB4MGZdICtcbiAgICAgIEhFWF9DSEFSU1soaDQgPj4gMTIpICYgMHgwZl0gK1xuICAgICAgSEVYX0NIQVJTWyhoNCA+PiA4KSAmIDB4MGZdICtcbiAgICAgIEhFWF9DSEFSU1soaDQgPj4gNCkgJiAweDBmXSArXG4gICAgICBIRVhfQ0hBUlNbaDQgJiAweDBmXVxuICAgICk7XG4gIH1cblxuICB0b1N0cmluZygpOiBzdHJpbmcge1xuICAgIHJldHVybiB0aGlzLmhleCgpO1xuICB9XG5cbiAgZGlnZXN0KCk6IG51bWJlcltdIHtcbiAgICB0aGlzLmZpbmFsaXplKCk7XG5cbiAgICBjb25zdCBoMCA9IHRoaXMuI2gwO1xuICAgIGNvbnN0IGgxID0gdGhpcy4jaDE7XG4gICAgY29uc3QgaDIgPSB0aGlzLiNoMjtcbiAgICBjb25zdCBoMyA9IHRoaXMuI2gzO1xuICAgIGNvbnN0IGg0ID0gdGhpcy4jaDQ7XG5cbiAgICByZXR1cm4gW1xuICAgICAgKGgwID4+IDI0KSAmIDB4ZmYsXG4gICAgICAoaDAgPj4gMTYpICYgMHhmZixcbiAgICAgIChoMCA+PiA4KSAmIDB4ZmYsXG4gICAgICBoMCAmIDB4ZmYsXG4gICAgICAoaDEgPj4gMjQpICYgMHhmZixcbiAgICAgIChoMSA+PiAxNikgJiAweGZmLFxuICAgICAgKGgxID4+IDgpICYgMHhmZixcbiAgICAgIGgxICYgMHhmZixcbiAgICAgIChoMiA+PiAyNCkgJiAweGZmLFxuICAgICAgKGgyID4+IDE2KSAmIDB4ZmYsXG4gICAgICAoaDIgPj4gOCkgJiAweGZmLFxuICAgICAgaDIgJiAweGZmLFxuICAgICAgKGgzID4+IDI0KSAmIDB4ZmYsXG4gICAgICAoaDMgPj4gMTYpICYgMHhmZixcbiAgICAgIChoMyA+PiA4KSAmIDB4ZmYsXG4gICAgICBoMyAmIDB4ZmYsXG4gICAgICAoaDQgPj4gMjQpICYgMHhmZixcbiAgICAgIChoNCA+PiAxNikgJiAweGZmLFxuICAgICAgKGg0ID4+IDgpICYgMHhmZixcbiAgICAgIGg0ICYgMHhmZixcbiAgICBdO1xuICB9XG5cbiAgYXJyYXkoKTogbnVtYmVyW10ge1xuICAgIHJldHVybiB0aGlzLmRpZ2VzdCgpO1xuICB9XG5cbiAgYXJyYXlCdWZmZXIoKTogQXJyYXlCdWZmZXIge1xuICAgIHRoaXMuZmluYWxpemUoKTtcblxuICAgIGNvbnN0IGJ1ZmZlciA9IG5ldyBBcnJheUJ1ZmZlcigyMCk7XG4gICAgY29uc3QgZGF0YVZpZXcgPSBuZXcgRGF0YVZpZXcoYnVmZmVyKTtcbiAgICBkYXRhVmlldy5zZXRVaW50MzIoMCwgdGhpcy4jaDApO1xuICAgIGRhdGFWaWV3LnNldFVpbnQzMig0LCB0aGlzLiNoMSk7XG4gICAgZGF0YVZpZXcuc2V0VWludDMyKDgsIHRoaXMuI2gyKTtcbiAgICBkYXRhVmlldy5zZXRVaW50MzIoMTIsIHRoaXMuI2gzKTtcbiAgICBkYXRhVmlldy5zZXRVaW50MzIoMTYsIHRoaXMuI2g0KTtcblxuICAgIHJldHVybiBidWZmZXI7XG4gIH1cbn1cbmV4cG9ydCBjbGFzcyBIbWFjU2hhMSBleHRlbmRzIFNoYTEge1xuICAjc2hhcmVkTWVtb3J5OiBib29sZWFuO1xuICAjaW5uZXI6IGJvb2xlYW47XG4gICNvS2V5UGFkOiBudW1iZXJbXTtcbiAgY29uc3RydWN0b3Ioc2VjcmV0S2V5OiBNZXNzYWdlLCBzaGFyZWRNZW1vcnkgPSBmYWxzZSkge1xuICAgIHN1cGVyKHNoYXJlZE1lbW9yeSk7XG4gICAgbGV0IGtleTogbnVtYmVyW10gfCBVaW50OEFycmF5IHwgdW5kZWZpbmVkO1xuICAgIGlmICh0eXBlb2Ygc2VjcmV0S2V5ID09PSBcInN0cmluZ1wiKSB7XG4gICAgICBjb25zdCBieXRlczogbnVtYmVyW10gPSBbXTtcbiAgICAgIGNvbnN0IGxlbmd0aDogbnVtYmVyID0gc2VjcmV0S2V5Lmxlbmd0aDtcbiAgICAgIGxldCBpbmRleCA9IDA7XG4gICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGxlbmd0aDsgaSsrKSB7XG4gICAgICAgIGxldCBjb2RlID0gc2VjcmV0S2V5LmNoYXJDb2RlQXQoaSk7XG4gICAgICAgIGlmIChjb2RlIDwgMHg4MCkge1xuICAgICAgICAgIGJ5dGVzW2luZGV4KytdID0gY29kZTtcbiAgICAgICAgfSBlbHNlIGlmIChjb2RlIDwgMHg4MDApIHtcbiAgICAgICAgICBieXRlc1tpbmRleCsrXSA9IDB4YzAgfCAoY29kZSA+PiA2KTtcbiAgICAgICAgICBieXRlc1tpbmRleCsrXSA9IDB4ODAgfCAoY29kZSAmIDB4M2YpO1xuICAgICAgICB9IGVsc2UgaWYgKGNvZGUgPCAweGQ4MDAgfHwgY29kZSA+PSAweGUwMDApIHtcbiAgICAgICAgICBieXRlc1tpbmRleCsrXSA9IDB4ZTAgfCAoY29kZSA+PiAxMik7XG4gICAgICAgICAgYnl0ZXNbaW5kZXgrK10gPSAweDgwIHwgKChjb2RlID4+IDYpICYgMHgzZik7XG4gICAgICAgICAgYnl0ZXNbaW5kZXgrK10gPSAweDgwIHwgKGNvZGUgJiAweDNmKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBjb2RlID0gMHgxMDAwMCArXG4gICAgICAgICAgICAoKChjb2RlICYgMHgzZmYpIDw8IDEwKSB8IChzZWNyZXRLZXkuY2hhckNvZGVBdCgrK2kpICYgMHgzZmYpKTtcbiAgICAgICAgICBieXRlc1tpbmRleCsrXSA9IDB4ZjAgfCAoY29kZSA+PiAxOCk7XG4gICAgICAgICAgYnl0ZXNbaW5kZXgrK10gPSAweDgwIHwgKChjb2RlID4+IDEyKSAmIDB4M2YpO1xuICAgICAgICAgIGJ5dGVzW2luZGV4KytdID0gMHg4MCB8ICgoY29kZSA+PiA2KSAmIDB4M2YpO1xuICAgICAgICAgIGJ5dGVzW2luZGV4KytdID0gMHg4MCB8IChjb2RlICYgMHgzZik7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIGtleSA9IGJ5dGVzO1xuICAgIH0gZWxzZSB7XG4gICAgICBpZiAoc2VjcmV0S2V5IGluc3RhbmNlb2YgQXJyYXlCdWZmZXIpIHtcbiAgICAgICAga2V5ID0gbmV3IFVpbnQ4QXJyYXkoc2VjcmV0S2V5KTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGtleSA9IHNlY3JldEtleTtcbiAgICAgIH1cbiAgICB9XG4gICAgaWYgKGtleS5sZW5ndGggPiA2NCkge1xuICAgICAga2V5ID0gbmV3IFNoYTEodHJ1ZSkudXBkYXRlKGtleSkuYXJyYXkoKTtcbiAgICB9XG4gICAgY29uc3Qgb0tleVBhZDogbnVtYmVyW10gPSBbXTtcbiAgICBjb25zdCBpS2V5UGFkOiBudW1iZXJbXSA9IFtdO1xuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgNjQ7IGkrKykge1xuICAgICAgY29uc3QgYiA9IGtleVtpXSB8fCAwO1xuICAgICAgb0tleVBhZFtpXSA9IDB4NWMgXiBiO1xuICAgICAgaUtleVBhZFtpXSA9IDB4MzYgXiBiO1xuICAgIH1cblxuICAgIHRoaXMudXBkYXRlKGlLZXlQYWQpO1xuICAgIHRoaXMuI29LZXlQYWQgPSBvS2V5UGFkO1xuICAgIHRoaXMuI2lubmVyID0gdHJ1ZTtcbiAgICB0aGlzLiNzaGFyZWRNZW1vcnkgPSBzaGFyZWRNZW1vcnk7XG4gIH1cbiAgcHJvdGVjdGVkIGZpbmFsaXplKCk6IHZvaWQge1xuICAgIHN1cGVyLmZpbmFsaXplKCk7XG4gICAgaWYgKHRoaXMuI2lubmVyKSB7XG4gICAgICB0aGlzLiNpbm5lciA9IGZhbHNlO1xuICAgICAgY29uc3QgaW5uZXJIYXNoID0gdGhpcy5hcnJheSgpO1xuICAgICAgc3VwZXIuaW5pdCh0aGlzLiNzaGFyZWRNZW1vcnkpO1xuICAgICAgdGhpcy51cGRhdGUodGhpcy4jb0tleVBhZCk7XG4gICAgICB0aGlzLnVwZGF0ZShpbm5lckhhc2gpO1xuICAgICAgc3VwZXIuZmluYWxpemUoKTtcbiAgICB9XG4gIH1cbn1cbiJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFZQSxLQUFLLENBQUMsU0FBUyxHQUFHLENBQWtCLGtCQUFDLEtBQUssQ0FBQyxDQUFFO0FBQzdDLEtBQUssQ0FBQyxLQUFLLEdBQUcsQ0FBQztLQUFDLFVBQVU7SUFBRSxPQUFPO0lBQUUsS0FBSztJQUFFLEdBQUc7QUFBQSxDQUFDO0FBQ2hELEtBQUssQ0FBQyxLQUFLLEdBQUcsQ0FBQztJQUFBLEVBQUU7SUFBRSxFQUFFO0lBQUUsQ0FBQztJQUFFLENBQUM7QUFBQSxDQUFDO0FBRTVCLEtBQUssQ0FBQyxNQUFNLEdBQWEsQ0FBQyxDQUFDO0FBRTNCLE1BQU0sT0FBTyxJQUFJO0lBQ2YsQ0FBQyxNQUFNO0lBQ1AsQ0FBQyxLQUFLO0lBQ04sQ0FBQyxLQUFLO0lBQ04sQ0FBQyxLQUFLO0lBQ04sQ0FBQyxNQUFNO0lBQ1AsQ0FBQyxTQUFTO0lBQ1YsQ0FBQyxNQUFNO0lBRVAsQ0FBQyxFQUFFLEdBQUcsVUFBVTtJQUNoQixDQUFDLEVBQUUsR0FBRyxVQUFVO0lBQ2hCLENBQUMsRUFBRSxHQUFHLFVBQVU7SUFDaEIsQ0FBQyxFQUFFLEdBQUcsU0FBVTtJQUNoQixDQUFDLEVBQUUsR0FBRyxVQUFVO0lBQ2hCLENBQUMsYUFBYSxHQUFHLENBQUM7Z0JBRU4sWUFBWSxHQUFHLEtBQUssQ0FBRSxDQUFDO1FBQ2pDLElBQUksQ0FBQyxJ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QUksQ0FBQyxLQUFNLEtBQUssRUFBQyxDQUFDLE1BQUssQ0FBQzt3QkFDdkQsTUFBTSxDQUFDLENBQUMsSUFBSSxDQUFDLE1BQU0sR0FBSSxHQUFJLElBQUksR0FBRyxFQUFJLEtBQU0sS0FBSyxFQUFDLENBQUMsTUFBSyxDQUFDO29CQUMzRCxDQUFDLE1BQU0sRUFBRSxFQUFFLElBQUksR0FBRyxLQUFNLElBQUksSUFBSSxJQUFJLEtBQU0sRUFBRSxDQUFDO3dCQUMzQyxNQUFNLENBQUMsQ0FBQyxJQUFJLENBQUMsTUFBTSxHQUFJLEdBQUksSUFBSSxJQUFJLEVBQUUsS0FBTSxLQUFLLEVBQUMsQ0FBQyxNQUFLLENBQUM7d0JBQ3hELE1BQU0sQ0FBQyxDQUFDLElBQUksQ0FBQyxNQUFNLEdBQUksR0FBSyxJQUFJLElBQUksQ0FBQyxHQUFJLEVBQUksS0FBTSxLQUFLLEVBQUMsQ0FBQyxNQUFLLENBQUM7d0JBQ2hFLE1BQU0sQ0FBQyxDQUFDLElBQUksQ0FBQyxNQUFNLEdBQUksR0FBSSxJQUFJLEdBQUcsRUFBSSxLQUFNLEtBQUssRUFBQyxDQUFDLE1BQUssQ0FBQztvQkFDM0QsQ0FBQyxNQUFNLENBQUM7d0JBQ04sSUFBSSxHQUFHLEtBQU8sS0FDVCxJQUFJLEdBQUcsSUFBSyxLQUFLLEVBQUUsR0FBSyxHQUFHLENBQUMsVUFBVSxHQUFHLEtBQUssSUFBSSxJQUFLO3dCQUM1RCxNQUFNLENBQUMsQ0FBQyxJQUFJLENBQUMsTUFBTSxHQUFJLEdBQUksSUFBSSxJQUFJLEVBQUUsS0FBTSxLQUFLLEVBQUMsQ0FBQyxNQUFLLENBQUM7d0JBQ3hELE1BQU0sQ0FBQyxDQUFDLElBQUksQ0FBQyxNQUFNLEdBQUksR0FBSyxJQUFJLElBQUksRUFBRSxHQUFJLEVBQUksS0FBTSxLQUFLLEVBQUMsQ0FBQyxNQUFLLENBQUM7d0JBQ2pFLE1BQU0sQ0FBQyxDQUFDLElBQUksQ0FBQyxNQUFNLEdBQUksR0FBSyxJQUFJLElBQUksQ0FBQyxHQUFJLEVBQUksS0FBTSxLQUFLLEVBQUMsQ0FBQyxNQUFLLENBQUM7d0JB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QUFDLEdBQUcsQ0FBQyxHQUFHLENBQUMsR0FBRyxVQUFVLEdBQUcsTUFBTSxDQUFDLENBQUMsR0FBRyxDQUFDLE1BQU8sQ0FBQztZQUNsRCxDQUFDLEdBQUksQ0FBQyxJQUFJLEVBQUUsR0FBSyxDQUFDLEtBQUssQ0FBQztZQUV4QixDQUFDLEdBQUksQ0FBQyxHQUFHLENBQUMsR0FBSyxDQUFDLEdBQUcsQ0FBQyxHQUFLLENBQUMsR0FBRyxDQUFDO1lBQzlCLENBQUMsR0FBSSxDQUFDLElBQUksQ0FBQyxHQUFLLENBQUMsS0FBSyxFQUFFO1lBQ3hCLENBQUMsR0FBSSxDQUFDLEdBQUcsQ0FBQyxHQUFHLENBQUMsR0FBRyxVQUFVLEdBQUcsTUFBTSxDQUFDLENBQUMsR0FBRyxDQUFDLE1BQU8sQ0FBQztZQUNsRCxDQUFDLEdBQUksQ0FBQyxJQUFJLEVBQUUsR0FBSyxDQUFDLEtBQUssQ0FBQztZQUV4QixDQUFDLEdBQUksQ0FBQyxHQUFHLENBQUMsR0FBSyxDQUFDLEdBQUcsQ0FBQyxHQUFLLENBQUMsR0FBRyxDQUFDO1lBQzlCLENBQUMsR0FBSSxDQUFDLElBQUksQ0FBQyxHQUFLLENBQUMsS0FBSyxFQUFFO1lBQ3hCLENBQUMsR0FBSSxDQUFDLEdBQUcsQ0FBQyxHQUFHLENBQUMsR0FBRyxVQUFVLEdBQUcsTUFBTSxDQUFDLENBQUMsR0FBRyxDQUFDLE1BQU8sQ0FBQztZQUNsRCxDQUFDLEdBQUksQ0FBQyxJQUFJLEVBQUUsR0FBSyxDQUFDLEtBQUssQ0FBQztZQUV4QixDQUFDLEdBQUksQ0FBQyxHQUFHLENBQUMsR0FBSyxDQUFDLEdBQUcsQ0FBQyxHQUFLLENBQUMsR0FBRyxDQUFDO1lBQzlCLENBQUMsR0FBSSxDQUFDLElBQUksQ0FBQyxHQUFLLENBQUMsS0FBSyxFQUFFO1lBQ3hCLENBQUMsR0FBSSxDQUFDLEdBQUcsQ0FBQyxHQUFHLENBQUMsR0FBRyxVQUFVLEdBQUcsTUFBTSxDQUFDLENBQUMsR0FBRyxDQUFDLE1BQU8sQ0FBQztZQUNsRCxDQUFDLEdBQUksQ0FBQyxJQUFJLEVBQUUsR0FB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QixLQUFLLENBQUMsRUFBRSxHQUFHLElBQUksQ0FBQyxDQUFDLEVBQUU7UUFDbkIsS0FBSyxDQUFDLEVBQUUsR0FBRyxJQUFJLENBQUMsQ0FBQyxFQUFFO1FBRW5CLE1BQU0sQ0FDSixTQUFTLENBQUUsRUFBRSxJQUFJLEVBQUUsR0FBSSxFQUFJLElBQzNCLFNBQVMsQ0FBRSxFQUFFLElBQUksRUFBRSxHQUFJLEVBQUksSUFDM0IsU0FBUyxDQUFFLEVBQUUsSUFBSSxFQUFFLEdBQUksRUFBSSxJQUMzQixTQUFTLENBQUUsRUFBRSxJQUFJLEVBQUUsR0FBSSxFQUFJLElBQzNCLFNBQVMsQ0FBRSxFQUFFLElBQUksRUFBRSxHQUFJLEVBQUksSUFDM0IsU0FBUyxDQUFFLEVBQUUsSUFBSSxDQUFDLEdBQUksRUFBSSxJQUMxQixTQUFTLENBQUUsRUFBRSxJQUFJLENBQUMsR0FBSSxFQUFJLElBQzFCLFNBQVMsQ0FBQyxFQUFFLEdBQUcsRUFBSSxJQUNuQixTQUFTLENBQUUsRUFBRSxJQUFJLEVBQUUsR0FBSSxFQUFJLElBQzNCLFNBQVMsQ0FBRSxFQUFFLElBQUksRUFBRSxHQUFJLEVBQUksSUFDM0IsU0FBUyxDQUFFLEVBQUUsSUFBSSxFQUFFLEdBQUksRUFBSSxJQUMzQixTQUFTLENBQUUsRUFBRSxJQUFJLEVBQUUsR0FBSSxFQUFJLElBQzNCLFNBQVMsQ0FBRSxFQUFFLElBQUksRUFBRSxHQUFJLEVBQUksSUFDM0IsU0FBUyxDQUFFLEVBQUUsSUFBSSxDQUFDLEdBQUksRUFBSSxJQUMxQixTQUFTLENBQUUsRUFBRSxJQUFJLENBQUMsR0FBSSxFQUFJLElBQzFCLFNBQVMsQ0FBQyxFQUFFLEdBQUcsRUFBSSxJQUNuQixTQUFTLENBQUUsRUFBRSxJQUFJLEVBQUUsR0FBSSxFQUFJLElBQzNCLFNBQVMsQ0FBRSxFQUFFLElBQUksRUFBRSxHQUFJLEVBQUksSUFDM0IsU0FBUyxDQUFFLEVBQUUsSUFBSSxFQUFFLEdBQUksRUFBSSxJQUMzQixTQUFTLENBQUUsRUFBRSxJQUFJLEVBQUUsR0FBSSxFQUFJLElBQzNCLFNBQVMsQ0FBRSxFQUFFLElBQUksRUFBRSxHQUFJLEVBQUksSUFDM0IsU0FBUyxDQUFFLEVBQUUsSUFBSSxDQUFDLEdBQUksRUFBSSxJQUMxQixTQUFTLENBQUUsRUFBRSxJQUFJLENBQUMsR0FBSSxFQUFJLElBQzFCLFNBQVMsQ0FBQyxFQUFFLEdBQUcsRUFBSSxJQUNuQixTQUFTLENBQUUsRUFBRSxJQUFJLEVBQUUsR0FBSSxFQUFJLElBQzNCLFNBQVMsQ0FBRSxFQUFFLElBQUksRUFBRSxHQUFJLEVBQUksSUFDM0IsU0FBUyxDQUFFLEVBQUUsSUFBSSxFQUFFLEdBQUksRUFBSSxJQUMzQixTQUFTLENBQUUsRUFBRSxJQUFJLEVBQUUsR0FBSSxFQUFJLElBQzNCLFNBQVMsQ0FBRSxFQUFFLElBQUksRUFBRSxHQUFJLEVBQUksSUFDM0IsU0FBUyxDQUFFLEVBQUUsSUFBSSxDQUFDLEdBQUksRUFBSSxJQUMxQixTQUFTLENBQUUsRUFBRSxJQUFJLENBQUMsR0FBSSxFQUFJLElBQzFCLFNBQVMsQ0FBQyxFQUFFLEdBQUcsRUFBSSxJQUNuQixTQUFTLENBQUUsRUFBRSxJQUFJLEVBQUUsR0FBSSxFQUFJLElBQzNCLFNBQVMsQ0FBRSxFQUFFLElBQUksRUFBRSxHQUFJLEVBQUksSUFDM0IsU0FBUyxDQUFFLEVBQUUsSUFBSSxFQUFFLEdBQUksRUFBSSxJQUMzQixTQUFTLENBQUUsRUFBRSxJQUFJLEVBQUUsR0FBSSxFQUFJLElBQzNCLFNBQVMsQ0FBRSxFQUFFLElBQUksRUFBRSxHQUFJLEVBQUksSUFDM0IsU0FBUyxDQUFFLEVBQUUsSUFBSSxDQUFDLEdBQUksRUFBSSxJQUMxQixTQUFTLENBQUUsRUFBRSxJQUFJLENBQUMsR0FBSSxFQUFJLElBQzFCLFNBQVMsQ0FBQyxFQUFFLEdBQUcsRUFBSTtJQUV2QixDQUFDO0lBRUQsUUFBUSxHQUFXLENBQUM7UUFDbEIsTUFBTSxDQUFDLElBQUksQ0FBQyxHQUFHO0lBQ2pCLENBQUM7SUFFRCxNQUFNLEdBQWEsQ0FBQztRQUNsQixJQUFJLENBQUMsUUFB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