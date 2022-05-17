import { assert } from "../_util/assert.ts";
import { copy } from "../bytes/mod.ts";
const MIN_READ = 32 * 1024;
const MAX_SIZE = 2 ** 32 - 2;
export class Buffer {
    #buf;
    #off = 0;
    constructor(ab) {
        this.#buf = ab === undefined ? new Uint8Array(0) : new Uint8Array(ab);
    }
    bytes(options = { copy: true }) {
        if (options.copy === false)
            return this.#buf.subarray(this.#off);
        return this.#buf.slice(this.#off);
    }
    empty() {
        return this.#buf.byteLength <= this.#off;
    }
    get length() {
        return this.#buf.byteLength - this.#off;
    }
    get capacity() {
        return this.#buf.buffer.byteLength;
    }
    truncate(n) {
        if (n === 0) {
            this.reset();
            return;
        }
        if (n < 0 || n > this.length) {
            throw Error("bytes.Buffer: truncation out of range");
        }
        this.#reslice(this.#off + n);
    }
    reset() {
        this.#reslice(0);
        this.#off = 0;
    }
    #tryGrowByReslice(n) {
        const l = this.#buf.byteLength;
        if (n <= this.capacity - l) {
            this.#reslice(l + n);
            return l;
        }
        return -1;
    }
    #reslice(len) {
        assert(len <= this.#buf.buffer.byteLength);
        this.#buf = new Uint8Array(this.#buf.buffer, 0, len);
    }
    readSync(p) {
        if (this.empty()) {
            this.reset();
            if (p.byteLength === 0) {
                return 0;
            }
            return null;
        }
        const nread = copy(this.#buf.subarray(this.#off), p);
        this.#off += nread;
        return nread;
    }
    read(p) {
        const rr = this.readSync(p);
        return Promise.resolve(rr);
    }
    writeSync(p) {
        const m = this.#grow(p.byteLength);
        return copy(p, this.#buf, m);
    }
    write(p) {
        const n = this.writeSync(p);
        return Promise.resolve(n);
    }
    #grow(n) {
        const m = this.length;
        if (m === 0 && this.#off !== 0) {
            this.reset();
        }
        const i = this.#tryGrowByReslice(n);
        if (i >= 0) {
            return i;
        }
        const c = this.capacity;
        if (n <= Math.floor(c / 2) - m) {
            copy(this.#buf.subarray(this.#off), this.#buf);
        }
        else if (c + n > MAX_SIZE) {
            throw new Error("The buffer cannot be grown beyond the maximum size.");
        }
        else {
            const buf = new Uint8Array(Math.min(2 * c + n, MAX_SIZE));
            copy(this.#buf.subarray(this.#off), buf);
            this.#buf = buf;
        }
        this.#off = 0;
        this.#reslice(Math.min(m + n, MAX_SIZE));
        return m;
    }
    grow(n) {
        if (n < 0) {
            throw Error("Buffer.grow: negative count");
        }
        const m = this.#grow(n);
        this.#reslice(m);
    }
    async readFrom(r) {
        let n = 0;
        const tmp = new Uint8Array(MIN_READ);
        while (true) {
            const shouldGrow = this.capacity - this.length < MIN_READ;
            const buf = shouldGrow
                ? tmp
                : new Uint8Array(this.#buf.buffer, this.length);
            const nread = await r.read(buf);
            if (nread === null) {
                return n;
            }
            if (shouldGrow)
                this.writeSync(buf.subarray(0, nread));
            else
                this.#reslice(this.length + nread);
            n += nread;
        }
    }
    readFromSync(r) {
        let n = 0;
        const tmp = new Uint8Array(MIN_READ);
        while (true) {
            const shouldGrow = this.capacity - this.length < MIN_READ;
            const buf = shouldGrow
                ? tmp
                : new Uint8Array(this.#buf.buffer, this.length);
            const nread = r.readSync(buf);
            if (nread === null) {
                return n;
            }
            if (shouldGrow)
                this.writeSync(buf.subarray(0, nread));
            else
                this.#reslice(this.length + nread);
            n += nread;
        }
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYnVmZmVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiYnVmZmVyLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUNBLE9BQU8sRUFBRSxNQUFNLEVBQUUsTUFBTSxvQkFBb0IsQ0FBQztBQUM1QyxPQUFPLEVBQUUsSUFBSSxFQUFFLE1BQU0saUJBQWlCLENBQUM7QUFPdkMsTUFBTSxRQUFRLEdBQUcsRUFBRSxHQUFHLElBQUksQ0FBQztBQUMzQixNQUFNLFFBQVEsR0FBRyxDQUFDLElBQUksRUFBRSxHQUFHLENBQUMsQ0FBQztBQWlCN0IsTUFBTSxPQUFPLE1BQU07SUFDakIsSUFBSSxDQUFhO0lBQ2pCLElBQUksR0FBRyxDQUFDLENBQUM7SUFFVCxZQUFZLEVBQXdDO1FBQ2xELElBQUksQ0FBQyxJQUFJLEdBQUcsRUFBRSxLQUFLLFNBQVMsQ0FBQyxDQUFDLENBQUMsSUFBSSxVQUFVLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksVUFBVSxDQUFDLEVBQUUsQ0FBQyxDQUFDO0lBQ3hFLENBQUM7SUFXRCxLQUFLLENBQUMsT0FBTyxHQUFHLEVBQUUsSUFBSSxFQUFFLElBQUksRUFBRTtRQUM1QixJQUFJLE9BQU8sQ0FBQyxJQUFJLEtBQUssS0FBSztZQUFFLE9BQU8sSUFBSSxDQUFDLElBQUksQ0FBQyxRQUFRLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFDO1FBQ2pFLE9BQU8sSUFBSSxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFDO0lBQ3BDLENBQUM7SUFHRCxLQUFLO1FBQ0gsT0FBTyxJQUFJLENBQUMsSUFBSSxDQUFDLFVBQVUsSUFBSSxJQUFJLENBQUMsSUFBSSxDQUFDO0lBQzNDLENBQUM7SUFHRCxJQUFJLE1BQU07UUFDUixPQUFPLElBQUksQ0FBQyxJQUFJLENBQUMsVUFBVSxHQUFHLElBQUksQ0FBQyxJQUFJLENBQUM7SUFDMUMsQ0FBQztJQUlELElBQUksUUFBUTtR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Q0FBQyxRQUFRLEdBQUcsSUFBSSxDQUFDLE1BQU0sR0FBRyxRQUFRLENBQUM7WUFHMUQsTUFBTSxHQUFHLEdBQUcsVUFBVTtnQkFDcEIsQ0FBQyxDQUFDLEdBQUc7Z0JBQ0wsQ0FBQyxDQUFDLElBQUksVUFBVSxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsTUFBTSxFQUFFLElBQUksQ0FBQyxNQUFNLENBQUMsQ0FBQztZQUVsRCxNQUFNLEtBQUssR0FBRyxDQUFDLENBQUMsUUFBUSxDQUFDLEdBQUcsQ0FBQyxDQUFDO1lBQzlCLElBQUksS0FBSyxLQUFLLElBQUksRUFBRTtnQkFDbEIsT0FBTyxDQUFDLENBQUM7YUFDVjtZQUdELElBQUksVUFBVTtnQkFBRSxJQUFJLENBQUMsU0FBUyxDQUFDLEdBQUcsQ0FBQyxRQUFRLENBQUMsQ0FBQyxFQUFFLEtBQUssQ0FBQyxDQUFDLENBQUM7O2dCQUNsRCxJQUFJLENBQUMsUUFBUSxDQUFDLElBQUksQ0FBQyxNQUFNLEdBQUcsS0FBSyxDQUFDLENBQUM7WUFFeEMsQ0FBQyxJQUFJLEtBQUssQ0FBQztTQUNaO0lBQ0gsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQ29weXJpZ2h0IDIwMTgtMjAyMSB0aGUgRGVubyBhdXRob3JzLiBBbGwgcmlnaHRzIHJlc2VydmVkLiBNSVQgbGljZW5zZS5cbmltcG9ydCB7IGFzc2VydCB9IGZyb20gXCIuLi9fdXRpbC9hc3NlcnQudHNcIjtcbmltcG9ydCB7IGNvcHkgfSBmcm9tIFwiLi4vYnl0ZXMvbW9kLnRzXCI7XG5pbXBvcnQgdHlwZSB7IFJlYWRlciwgUmVhZGVyU3luYyB9IGZyb20gXCIuL3R5cGVzLmQudHNcIjtcblxuLy8gTUlOX1JFQUQgaXMgdGhlIG1pbmltdW0gQXJyYXlCdWZmZXIgc2l6ZSBwYXNzZWQgdG8gYSByZWFkIGNhbGwgYnlcbi8vIGJ1ZmZlci5SZWFkRnJvbS4gQXMgbG9uZyBhcyB0aGUgQnVmZmVyIGhhcyBhdCBsZWFzdCBNSU5fUkVBRCBieXRlcyBiZXlvbmRcbi8vIHdoYXQgaXMgcmVxdWlyZWQgdG8gaG9sZCB0aGUgY29udGVudHMgb2YgciwgcmVhZEZyb20oKSB3aWxsIG5vdCBncm93IHRoZVxuLy8gdW5kZXJseWluZyBidWZmZXIuXG5jb25zdCBNSU5fUkVBRCA9IDMyICogMTAyNDtcbmNvbnN0IE1BWF9TSVpFID0gMiAqKiAzMiAtIDI7XG5cbi8qKiBBIHZhcmlhYmxlLXNpemVkIGJ1ZmZlciBvZiBieXRlcyB3aXRoIGByZWFkKClgIGFuZCBgd3JpdGUoKWAgbWV0aG9kcy5cbiAqXG4gKiBCdWZmZXIgaXMgYWxtb3N0IGFsd2F5cyB1c2VkIHdpdGggc29tZSBJL08gbGlrZSBmaWxlcyBhbmQgc29ja2V0cy4gSXQgYWxsb3dzXG4gKiBvbmUgdG8gYnVmZmVyIHVwIGEgZG93bmxvYWQgZnJvbSBhIHNvY2tldC4gQnVmZmVyIGdyb3dzIGFuZCBzaHJpbmtzIGFzXG4gKiBuZWNlc3NhcnkuXG4gKlxuICogQnVmZmVyIGlzIE5PVCB0aGUgc2FtZSB0aGluZyBhcyBOb2RlJ3MgQnVmZmVyLiBOb2RlJ3MgQnVmZmVyIHdhcyBjcmVhdGVkIGluXG4gKiAyMDA5IGJlZm9yZSBKYXZhU2NyaXB0IGhhZCB0aGUgY29uY2VwdCBvZiBBcnJheUJ1ZmZlcnMuIEl0J3Mgc2ltcGx5IGFcbiAqIG5vbi1zdGFuZGFyZCBBcnJheUJ1ZmZlci5cbiAqXG4gKiBBcnJheUJ1ZmZlciBpcyBhIGZpeGVkIG1lbW9yeSBhbGxvY2F0aW9uLiBCdWZmZXIgaXMgaW1wbGVtZW50ZWQgb24gdG9wIG9mXG4gKiBBcnJheUJ1ZmZlci5cbiAqXG4gKiBCYXNlZCBvbiBbR28gQnVmZmVyXShodHRwczovL2dvbGFuZy5vcmcvcGtnL2J5dGVzLyNCdWZmZXIpLiAqL1xuXG5leHBvcnQgY2xhc3MgQnVmZmVyIHtcbiAgI2J1ZjogVWludDhBcnJheTsgLy8gY29udGVudHMgYXJlIHRoZSBieXRlcyBidWZbb2ZmIDogbGVuKGJ1ZildXG4gICNvZmYgPSAwOyAvLyByZWFkIGF0IGJ1ZltvZmZdLCB3cml0ZSBhdCBidWZbYnVmLmJ5dGVMZW5ndGhdXG5cbiAgY29uc3RydWN0b3IoYWI/OiBBcnJheUJ1ZmZlckxpa2UgfCBBcnJheUxpa2U8bnVtYmVyPikge1xuICAgIHRoaXMuI2J1ZiA9IGFiID09PSB1bmRlZmluZWQgPyBuZXcgVWludDhBcnJheSgwKSA6IG5ldyBVaW50OEFycmF5KGFiKTtcbiAgfVxuXG4gIC8qKiBSZXR1cm5zIGEgc2xpY2UgaG9sZGluZyB0aGUgdW5yZWFkIHBvcnRpb24gb2YgdGhlIGJ1ZmZlci5cbiAgICpcbiAgICogVGhlIHNsaWNlIGlzIHZhbGlkIGZvciB1c2Ugb25seSB1bnRpbCB0aGUgbmV4dCBidWZmZXIgbW9kaWZpY2F0aW9uICh0aGF0XG4gICAqIGlzLCBvbmx5IHVudGlsIHRoZSBuZXh0IGNhbGwgdG8gYSBtZXRob2QgbGlrZSBgcmVhZCgpYCwgYHdyaXRlKClgLFxuICAgKiBgcmVzZXQoKWAsIG9yIGB0cnVuY2F0ZSgpYCkuIElmIGBvcHRpb25zLmNvcHlgIGlzIGZhbHNlIHRoZSBzbGljZSBhbGlhc2VzIHRoZSBidWZmZXIgY29udGVudCBhdFxuICAgKiBsZWFzdCB1bnRpbCB0aGUgbmV4dCBidWZmZXIgbW9kaWZpY2F0aW9uLCBzbyBpbW1lZGlhdGUgY2hhbmdlcyB0byB0aGVcbiAgICogc2xpY2Ugd2lsbCBhZmZlY3QgdGhlIHJlc3VsdCBvZiBmdXR1cmUgcmVhZHMuXG4gICAqIEBwYXJhbSBvcHRpb25zIERlZmF1bHRzIHRvIGB7IGNvcHk6IHRydWUgfWBcbiAgICovXG4gIGJ5dGVzKG9wdGlvbnMgPSB7IGNvcHk6IHRydWUgfSk6IFVpbnQ4QXJyYXkge1xuICAgIGlmIChvcHRpb25zLmNvcHkgPT09IGZhbHNlKSByZXR1cm4gdGhpcy4jYnVmLnN1YmFycmF5KHRoaXMuI29mZik7XG4gICAgcmV0dXJuIHRoaXMuI2J1Zi5zbGljZSh0aGlzLiNvZmYpO1xuICB9XG5cbiAgLyoqIFJldHVybnMgd2hldGhlciB0aGUgdW5yZWFkIHBvcnRpb24gb2YgdGhlIGJ1ZmZlciBpcyBlbXB0eS4gKi9cbiAgZW1wdHkoKTogYm9vbGVhbiB7XG4gICAgcmV0dXJuIHRoaXMuI2J1Zi5ieXRlTGVuZ3RoIDw9IHRoaXMuI29mZjtcbiAgfVxuXG4gIC8qKiBBIHJlYWQgb25seSBudW1iZXIgb2YgYnl0ZXMgb2YgdGhlIHVucmVhZCBwb3J0aW9uIG9mIHRoZSBidWZmZXIuICovXG4gIGdldCBsZW5ndGgoKTogbnVtYmVyIHtcbiAgICByZXR1cm4gdGhpcy4jYnVmLmJ5dGVMZW5ndGggLSB0aGlzLiNvZmY7XG4gIH1cblxuICAvKiogVGhlIHJlYWQgb25seSBjYXBhY2l0eSBvZiB0aGUgYnVmZmVyJ3MgdW5kZXJseWluZyBieXRlIHNsaWNlLCB0aGF0IGlzLFxuICAgKiB0aGUgdG90YWwgc3BhY2UgYWxsb2NhdGVkIGZvciB0aGUgYnVmZmVyJ3MgZGF0YS4gKi9cbiAgZ2V0IGNhcGFjaXR5KCk6IG51bWJlciB7XG4gICAgcmV0dXJuIHRoaXMuI2J1Zi5idWZmZXIuYnl0ZUxlbmd0aDtcbiAgfVxuXG4gIC8qKiBEaXNjYXJkcyBhbGwgYnV0IHRoZSBmaXJzdCBgbmAgdW5yZWFkIGJ5dGVzIGZyb20gdGhlIGJ1ZmZlciBidXRcbiAgICogY29udGludWVzIHRvIHVzZSB0aGUgc2FtZSBhbGxvY2F0ZWQgc3RvcmFnZS4gSXQgdGhyb3dzIGlmIGBuYCBpc1xuICAgKiBuZWdhdGl2ZSBvciBncmVhdGVyIHRoYW4gdGhlIGxlbmd0aCBvZiB0aGUgYnVmZmVyLiAqL1xuICB0cnVuY2F0ZShuOiBudW1iZXIpOiB2b2lkIHtcbiAgICBpZiAobiA9PT0gMCkge1xuICAgICAgdGhpcy5yZXNldCgpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBpZiAobiA8IDAgfHwgbiA+IHRoaXMubGVuZ3RoKSB7XG4gICAgICB0aHJvdyBFcnJvcihcImJ5dGVzLkJ1ZmZlcjogdHJ1bmNhdGlvbiBvdXQgb2YgcmFuZ2VcIik7XG4gICAgfVxuICAgIHRoaXMuI3Jlc2xpY2UodGhpcy4jb2ZmICsgbik7XG4gIH1cblxuICByZXNldCgpOiB2b2lkIHtcbiAgICB0aGlzLiNyZXNsaWNlKDApO1xuICAgIHRoaXMuI29mZiA9IDA7XG4gIH1cblxuICAjdHJ5R3Jvd0J5UmVzbGljZShuOiBudW1iZXIpIHtcbiAgICBjb25zdCBsID0gdGhpcy4jYnVmLmJ5dGVMZW5ndGg7XG4gICAgaWYgKG4gPD0gdGhpcy5jYXBhY2l0eSAtIGwpIHtcbiAgICAgIHRoaXMuI3Jlc2xpY2UobCArIG4pO1xuICAgICAgcmV0dXJuIGw7XG4gICAgfVxuICAgIHJldHVybiAtMTtcbiAgfVxuXG4gICNyZXNsaWNlKGxlbjogbnVtYmVyKSB7XG4gICAgYXNzZXJ0KGxlbiA8PSB0aGlzLiNidWYuYnVmZmVyLmJ5dGVMZW5ndGgpO1xuICAgIHRoaXMuI2J1ZiA9IG5ldyBVaW50OEFycmF5KHRoaXMuI2J1Zi5idWZmZXIsIDAsIGxlbik7XG4gIH1cblxuICAvKiogUmVhZHMgdGhlIG5leHQgYHAubGVuZ3RoYCBieXRlcyBmcm9tIHRoZSBidWZmZXIgb3IgdW50aWwgdGhlIGJ1ZmZlciBpc1xuICAgKiBkcmFpbmVkLiBSZXR1cm5zIHRoZSBudW1iZXIgb2YgYnl0ZXMgcmVhZC4gSWYgdGhlIGJ1ZmZlciBoYXMgbm8gZGF0YSB0b1xuICAgKiByZXR1cm4sIHRoZSByZXR1cm4gaXMgRU9GIChgbnVsbGApLiAqL1xuICByZWFkU3luYyhwOiBVaW50OEFycmF5KTogbnVtYmVyIHwgbnVsbCB7XG4gICAgaWYgKHRoaXMuZW1wdHkoKSkge1xuICAgICAgLy8gQnVmZmVyIGlzIGVtcHR5LCByZXNldCB0byByZWNvdmVyIHNwYWNlLlxuICAgICAgdGhpcy5yZXNldCgpO1xuICAgICAgaWYgKHAuYnl0ZUxlbmd0aCA9PT0gMCkge1xuICAgICAgICAvLyB0aGlzIGVkZ2UgY2FzZSBpcyB0ZXN0ZWQgaW4gJ2J1ZmZlclJlYWRFbXB0eUF0RU9GJyB0ZXN0XG4gICAgICAgIHJldHVybiAwO1xuICAgICAgfVxuICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuICAgIGNvbnN0IG5yZWFkID0gY29weSh0aGlzLiNidWYuc3ViYXJyYXkodGhpcy4jb2ZmKSwgcCk7XG4gICAgdGhpcy4jb2ZmICs9IG5yZWFkO1xuICAgIHJldHVybiBucmVhZDtcbiAgfVxuXG4gIC8qKiBSZWFkcyB0aGUgbmV4dCBgcC5sZW5ndGhgIGJ5dGVzIGZyb20gdGhlIGJ1ZmZlciBvciB1bnRpbCB0aGUgYnVmZmVyIGlzXG4gICAqIGRyYWluZWQuIFJlc29sdmVzIHRvIHRoZSBudW1iZXIgb2YgYnl0ZXMgcmVhZC4gSWYgdGhlIGJ1ZmZlciBoYXMgbm9cbiAgICogZGF0YSB0byByZXR1cm4sIHJlc29sdmVzIHRvIEVPRiAoYG51bGxgKS5cbiAgICpcbiAgICogTk9URTogVGhpcyBtZXRob2RzIHJlYWRzIGJ5dGVzIHN5bmNocm9ub3VzbHk7IGl0J3MgcHJvdmlkZWQgZm9yXG4gICAqIGNvbXBhdGliaWxpdHkgd2l0aCBgUmVhZGVyYCBpbnRlcmZhY2VzLlxuICAgKi9cbiAgcmVhZChwOiBVaW50OEFycmF5KTogUHJvbWlzZTxudW1iZXIgfCBudWxsPiB7XG4gICAgY29uc3QgcnIgPSB0aGlzLnJlYWRTeW5jKHApO1xuICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUocnIpO1xuICB9XG5cbiAgd3JpdGVTeW5jKHA6IFVpbnQ4QXJyYXkpOiBudW1iZXIge1xuICAgIGNvbnN0IG0gPSB0aGlzLiNncm93KHAuYnl0ZUxlbmd0aCk7XG4gICAgcmV0dXJuIGNvcHkocCwgdGhpcy4jYnVmLCBtKTtcbiAgfVxuXG4gIC8qKiBOT1RFOiBUaGlzIG1ldGhvZHMgd3JpdGVzIGJ5dGVzIHN5bmNocm9ub3VzbHk7IGl0J3MgcHJvdmlkZWQgZm9yXG4gICAqIGNvbXBhdGliaWxpdHkgd2l0aCBgV3JpdGVyYCBpbnRlcmZhY2UuICovXG4gIHdyaXRlKHA6IFVpbnQ4QXJyYXkpOiBQcm9taXNlPG51bWJlcj4ge1xuICAgIGNvbnN0IG4gPSB0aGlzLndyaXRlU3luYyhwKTtcbiAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKG4pO1xuICB9XG5cbiAgI2dyb3cobjogbnVtYmVyKSB7XG4gICAgY29uc3QgbSA9IHRoaXMubGVuZ3RoO1xuICAgIC8vIElmIGJ1ZmZlciBpcyBlbXB0eSwgcmVzZXQgdG8gcmVjb3ZlciBzcGFjZS5cbiAgICBpZiAobSA9PT0gMCAmJiB0aGlzLiNvZmYgIT09IDApIHtcbiAgICAgIHRoaXMucmVzZXQoKTtcbiAgICB9XG4gICAgLy8gRmFzdDogVHJ5IHRvIGdyb3cgYnkgbWVhbnMgb2YgYSByZXNsaWNlLlxuICAgIGNvbnN0IGkgPSB0aGlzLiN0cnlHcm93QnlSZXNsaWNlKG4pO1xuICAgIGlmIChpID49IDApIHtcbiAgICAgIHJldHVybiBpO1xuICAgIH1cbiAgICBjb25zdCBjID0gdGhpcy5jYXBhY2l0eTtcbiAgICBpZiAobiA8PSBNYXRoLmZsb29yKGMgLyAyKSAtIG0pIHtcbiAgICAgIC8vIFdlIGNhbiBzbGlkZSB0aGluZ3MgZG93biBpbnN0ZWFkIG9mIGFsbG9jYXRpbmcgYSBuZXdcbiAgICAgIC8vIEFycmF5QnVmZmVyLiBXZSBvbmx5IG5lZWQgbStuIDw9IGMgdG8gc2xpZGUsIGJ1dFxuICAgICAgLy8gd2UgaW5zdGVhZCBsZXQgY2FwYWNpdHkgZ2V0IHR3aWNlIGFzIGxhcmdlIHNvIHdlXG4gICAgICAvLyBkb24ndCBzcGVuZCBhbGwgb3VyIHRpbWUgY29weWluZy5cbiAgICAgIGNvcHkodGhpcy4jYnVmLnN1YmFycmF5KHRoaXMuI29mZiksIHRoaXMuI2J1Zik7XG4gICAgfSBlbHNlIGlmIChjICsgbiA+IE1BWF9TSVpFKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJUaGUgYnVmZmVyIGNhbm5vdCBiZSBncm93biBiZXlvbmQgdGhlIG1heGltdW0gc2l6ZS5cIik7XG4gICAgfSBlbHNlIHtcbiAgICAgIC8vIE5vdCBlbm91Z2ggc3BhY2UgYW55d2hlcmUsIHdlIG5lZWQgdG8gYWxsb2NhdGUuXG4gICAgICBjb25zdCBidWYgPSBuZXcgVWludDhBcnJheShNYXRoLm1pbigyICogYyArIG4sIE1BWF9TSVpFKSk7XG4gICAgICBjb3B5KHRoaXMuI2J1Zi5zdWJhcnJheSh0aGlzLiNvZmYpLCBidWYpO1xuICAgICAgdGhpcy4jYnVmID0gYnVmO1xuICAgIH1cbiAgICAvLyBSZXN0b3JlIHRoaXMuI29mZiBhbmQgbGVuKHRoaXMuI2J1ZikuXG4gICAgdGhpcy4jb2ZmID0gMDtcbiAgICB0aGlzLiNyZXNsaWNlKE1hdGgubWluKG0gKyBuLCBNQVhfU0laRSkpO1xuICAgIHJldHVybiBtO1xuICB9XG5cbiAgLyoqIEdyb3dzIHRoZSBidWZmZXIncyBjYXBhY2l0eSwgaWYgbmVjZXNzYXJ5LCB0byBndWFyYW50ZWUgc3BhY2UgZm9yXG4gICAqIGFub3RoZXIgYG5gIGJ5dGVzLiBBZnRlciBgLmdyb3cobilgLCBhdCBsZWFzdCBgbmAgYnl0ZXMgY2FuIGJlIHdyaXR0ZW4gdG9cbiAgICogdGhlIGJ1ZmZlciB3aXRob3V0IGFub3RoZXIgYWxsb2NhdGlvbi4gSWYgYG5gIGlzIG5lZ2F0aXZlLCBgLmdyb3coKWAgd2lsbFxuICAgKiB0aHJvdy4gSWYgdGhlIGJ1ZmZlciBjYW4ndCBncm93IGl0IHdpbGwgdGhyb3cgYW4gZXJyb3IuXG4gICAqXG4gICAqIEJhc2VkIG9uIEdvIExhbmcnc1xuICAgKiBbQnVmZmVyLkdyb3ddKGh0dHBzOi8vZ29sYW5nLm9yZy9wa2cvYnl0ZXMvI0J1ZmZlci5Hcm93KS4gKi9cbiAgZ3JvdyhuOiBudW1iZXIpOiB2b2lkIHtcbiAgICBpZiAobiA8IDApIHtcbiAgICAgIHRocm93IEVycm9yKFwiQnVmZmVyLmdyb3c6IG5lZ2F0aXZlIGNvdW50XCIpO1xuICAgIH1cbiAgICBjb25zdCBtID0gdGhpcy4jZ3JvdyhuKTtcbiAgICB0aGlzLiNyZXNsaWNlKG0pO1xuICB9XG5cbiAgLyoqIFJlYWRzIGRhdGEgZnJvbSBgcmAgdW50aWwgRU9GIChgbnVsbGApIGFuZCBhcHBlbmRzIGl0IHRvIHRoZSBidWZmZXIsXG4gICAqIGdyb3dpbmcgdGhlIGJ1ZmZlciBhcyBuZWVkZWQuIEl0IHJlc29sdmVzIHRvIHRoZSBudW1iZXIgb2YgYnl0ZXMgcmVhZC5cbiAgICogSWYgdGhlIGJ1ZmZlciBiZWNvbWVzIHRvbyBsYXJnZSwgYC5yZWFkRnJvbSgpYCB3aWxsIHJlamVjdCB3aXRoIGFuIGVycm9yLlxuICAgKlxuICAgKiBCYXNlZCBvbiBHbyBMYW5nJ3NcbiAgICogW0J1ZmZlci5SZWFkRnJvbV0oaHR0cHM6Ly9nb2xhbmcub3JnL3BrZy9ieXRlcy8jQnVmZmVyLlJlYWRGcm9tKS4gKi9cbiAgYXN5bmMgcmVhZEZyb20ocjogUmVhZGVyKTogUHJvbWlzZTxudW1iZXI+IHtcbiAgICBsZXQgbiA9IDA7XG4gICAgY29uc3QgdG1wID0gbmV3IFVpbnQ4QXJyYXkoTUlOX1JFQUQpO1xuICAgIHdoaWxlICh0cnVlKSB7XG4gICAgICBjb25zdCBzaG91bGRHcm93ID0gdGhpcy5jYXBhY2l0eSAtIHRoaXMubGVuZ3RoIDwgTUlOX1JFQUQ7XG4gICAgICAvLyByZWFkIGludG8gdG1wIGJ1ZmZlciBpZiB0aGVyZSdzIG5vdCBlbm91Z2ggcm9vbVxuICAgICAgLy8gb3RoZXJ3aXNlIHJlYWQgZGlyZWN0bHkgaW50byB0aGUgaW50ZXJuYWwgYnVmZmVyXG4gICAgICBjb25zdCBidWYgPSBzaG91bGRHcm93XG4gICAgICAgID8gdG1wXG4gICAgICAgIDogbmV3IFVpbnQ4QXJyYXkodGhpcy4jYnVmLmJ1ZmZlciwgdGhpcy5sZW5ndGgpO1xuXG4gICAgICBjb25zdCBucmVhZCA9IGF3YWl0IHIucmVhZChidWYpO1xuICAgICAgaWYgKG5yZWFkID09PSBudWxsKSB7XG4gICAgICAgIHJldHVybiBuO1xuICAgICAgfVxuXG4gICAgICAvLyB3cml0ZSB3aWxsIGdyb3cgaWYgbmVlZGVkXG4gICAgICBpZiAoc2hvdWxkR3JvdykgdGhpcy53cml0ZVN5bmMoYnVmLnN1YmFycmF5KDAsIG5yZWFkKSk7XG4gICAgICBlbHNlIHRoaXMuI3Jlc2xpY2UodGhpcy5sZW5ndGggKyBucmVhZCk7XG5cbiAgICAgIG4gKz0gbnJlYWQ7XG4gICAgfVxuICB9XG5cbiAgLyoqIFJlYWRzIGRhdGEgZnJvbSBgcmAgdW50aWwgRU9GIChgbnVsbGApIGFuZCBhcHBlbmRzIGl0IHRvIHRoZSBidWZmZXIsXG4gICAqIGdyb3dpbmcgdGhlIGJ1ZmZlciBhcyBuZWVkZWQuIEl0IHJldHVybnMgdGhlIG51bWJlciBvZiBieXRlcyByZWFkLiBJZiB0aGVcbiAgICogYnVmZmVyIGJlY29tZXMgdG9vIGxhcmdlLCBgLnJlYWRGcm9tU3luYygpYCB3aWxsIHRocm93IGFuIGVycm9yLlxuICAgKlxuICAgKiBCYXNlZCBvbiBHbyBMYW5nJ3NcbiAgICogW0J1ZmZlci5SZWFkRnJvbV0oaHR0cHM6Ly9nb2xhbmcub3JnL3BrZy9ieXRlcy8jQnVmZmVyLlJlYWRGcm9tKS4gKi9cbiAgcmVhZEZyb21TeW5jKHI6IFJlYWRlclN5bmMpOiBudW1iZXIge1xuICAgIGxldCBuID0gMDtcbiAgICBjb25zdCB0bXAgPSBuZXcgVWludDhBcnJheShNSU5fUkVBRCk7XG4gICAgd2hpbGUgKHRydWUpIHtcbiAgICAgIGNvbnN0IHNob3VsZEdyb3cgPSB0aGlzLmNhcGFjaXR5IC0gdGhpcy5sZW5ndGggPCBNSU5fUkVBRDtcbiAgICAgIC8vIHJlYWQgaW50byB0bXAgYnVmZmVyIGlmIHRoZXJlJ3Mgbm90IGVub3VnaCByb29tXG4gICAgICAvLyBvdGhlcndpc2UgcmVhZCBkaXJlY3RseSBpbnRvIHRoZSBpbnRlcm5hbCBidWZmZXJcbiAgICAgIGNvbnN0IGJ1ZiA9IHNob3VsZEdyb3dcbiAgICAgICAgPyB0bXBcbiAgICAgICAgOiBuZXcgVWludDhBcnJheSh0aGlzLiNidWYuYnVmZmVyLCB0aGlzLmxlbmd0aCk7XG5cbiAgICAgIGNvbnN0IG5yZWFkID0gci5yZWFkU3luYyhidWYpO1xuICAgICAgaWYgKG5yZWFkID09PSBudWxsKSB7XG4gICAgICAgIHJldHVybiBuO1xuICAgICAgfVxuXG4gICAgICAvLyB3cml0ZSB3aWxsIGdyb3cgaWYgbmVlZGVkXG4gICAgICBpZiAoc2hvdWxkR3JvdykgdGhpcy53cml0ZVN5bmMoYnVmLnN1YmFycmF5KDAsIG5yZWFkKSk7XG4gICAgICBlbHNlIHRoaXMuI3Jlc2xpY2UodGhpcy5sZW5ndGggKyBucmVhZCk7XG5cbiAgICAgIG4gKz0gbnJlYWQ7XG4gICAgfVxuICB9XG59XG4iXX0=