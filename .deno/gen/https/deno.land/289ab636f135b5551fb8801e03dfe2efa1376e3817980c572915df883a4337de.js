// Copyright 2018-2021 the Deno authors. All rights reserved. MIT license.
// Based on https://github.com/golang/go/blob/0452f9460f50f0f0aba18df43dc2b31906fb66cc/src/io/io.go
// Copyright 2009 The Go Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.
import { Buffer } from "./buffer.ts";
/** Reader utility for strings */ export class StringReader extends Buffer {
    constructor(s){
        super(new TextEncoder().encode(s).buffer);
    }
}
/** Reader utility for combining multiple readers */ export class MultiReader {
    readers;
    currentIndex = 0;
    constructor(...readers){
        this.readers = readers;
    }
    async read(p) {
        const r = this.readers[this.currentIndex];
        if (!r) return null;
        const result = await r.read(p);
        if (result === null) {
            this.currentIndex++;
            return 0;
        }
        return result;
    }
}
/**
 * A `LimitedReader` reads from `reader` but limits the amount of data returned to just `limit` bytes.
 * Each call to `read` updates `limit` to reflect the new amount remaining.
 * `read` returns `null` when `limit` <= `0` or
 * when the underlying `reader` returns `null`.
 */ export class LimitedReader {
    reader;
    limit;
    constructor(reader, limit){
        this.reader = reader;
        this.limit = limit;
    }
    async read(p) {
        if (this.limit <= 0) {
            return null;
        }
        if (p.length > this.limit) {
            p = p.subarray(0, this.limit);
        }
        const n = await this.reader.read(p);
        if (n == null) {
            return null;
        }
        this.limit -= n;
        return n;
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbImh0dHBzOi8vZGVuby5sYW5kL3N0ZEAwLjk5LjAvaW8vcmVhZGVycy50cyJdLCJzb3VyY2VzQ29udGVudCI6WyIvLyBDb3B5cmlnaHQgMjAxOC0yMDIxIHRoZSBEZW5vIGF1dGhvcnMuIEFsbCByaWdodHMgcmVzZXJ2ZWQuIE1JVCBsaWNlbnNlLlxuLy8gQmFzZWQgb24gaHR0cHM6Ly9naXRodWIuY29tL2dvbGFuZy9nby9ibG9iLzA0NTJmOTQ2MGY1MGYwZjBhYmExOGRmNDNkYzJiMzE5MDZmYjY2Y2Mvc3JjL2lvL2lvLmdvXG4vLyBDb3B5cmlnaHQgMjAwOSBUaGUgR28gQXV0aG9ycy4gQWxsIHJpZ2h0cyByZXNlcnZlZC5cbi8vIFVzZSBvZiB0aGlzIHNvdXJjZSBjb2RlIGlzIGdvdmVybmVkIGJ5IGEgQlNELXN0eWxlXG4vLyBsaWNlbnNlIHRoYXQgY2FuIGJlIGZvdW5kIGluIHRoZSBMSUNFTlNFIGZpbGUuXG5cbmltcG9ydCB7IEJ1ZmZlciB9IGZyb20gXCIuL2J1ZmZlci50c1wiO1xuXG4vKiogUmVhZGVyIHV0aWxpdHkgZm9yIHN0cmluZ3MgKi9cbmV4cG9ydCBjbGFzcyBTdHJpbmdSZWFkZXIgZXh0ZW5kcyBCdWZmZXIge1xuICBjb25zdHJ1Y3RvcihzOiBzdHJpbmcpIHtcbiAgICBzdXBlcihuZXcgVGV4dEVuY29kZXIoKS5lbmNvZGUocykuYnVmZmVyKTtcbiAgfVxufVxuXG4vKiogUmVhZGVyIHV0aWxpdHkgZm9yIGNvbWJpbmluZyBtdWx0aXBsZSByZWFkZXJzICovXG5leHBvcnQgY2xhc3MgTXVsdGlSZWFkZXIgaW1wbGVtZW50cyBEZW5vLlJlYWRlciB7XG4gIHByaXZhdGUgcmVhZG9ubHkgcmVhZGVyczogRGVuby5SZWFkZXJbXTtcbiAgcHJpdmF0ZSBjdXJyZW50SW5kZXggPSAwO1xuXG4gIGNvbnN0cnVjdG9yKC4uLnJlYWRlcnM6IERlbm8uUmVhZGVyW10pIHtcbiAgICB0aGlzLnJlYWRlcnMgPSByZWFkZXJzO1xuICB9XG5cbiAgYXN5bmMgcmVhZChwOiBVaW50OEFycmF5KTogUHJvbWlzZTxudW1iZXIgfCBudWxsPiB7XG4gICAgY29uc3QgciA9IHRoaXMucmVhZGVyc1t0aGlzLmN1cnJlbnRJbmRleF07XG4gICAgaWYgKCFyKSByZXR1cm4gbnVsbDtcbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCByLnJlYWQocCk7XG4gICAgaWYgKHJlc3VsdCA9PT0gbnVsbCkge1xuICAgICAgdGhpcy5jdXJyZW50SW5kZXgrKztcbiAgICAgIHJldHVybiAwO1xuICAgIH1cbiAgICByZXR1cm4gcmVzdWx0O1xuICB9XG59XG5cbi8qKlxuICogQSBgTGltaXRlZFJlYWRlcmAgcmVhZHMgZnJvbSBgcmVhZGVyYCBidXQgbGltaXRzIHRoZSBhbW91bnQgb2YgZGF0YSByZXR1cm5lZCB0byBqdXN0IGBsaW1pdGAgYnl0ZXMuXG4gKiBFYWNoIGNhbGwgdG8gYHJlYWRgIHVwZGF0ZXMgYGxpbWl0YCB0byByZWZsZWN0IHRoZSBuZXcgYW1vdW50IHJlbWFpbmluZy5cbiAqIGByZWFkYCByZXR1cm5zIGBudWxsYCB3aGVuIGBsaW1pdGAgPD0gYDBgIG9yXG4gKiB3aGVuIHRoZSB1bmRlcmx5aW5nIGByZWFkZXJgIHJldHVybnMgYG51bGxgLlxuICovXG5leHBvcnQgY2xhc3MgTGltaXRlZFJlYWRlciBpbXBsZW1lbnRzIERlbm8uUmVhZGVyIHtcbiAgY29uc3RydWN0b3IocHVibGljIHJlYWRlcjogRGVuby5SZWFkZXIsIHB1YmxpYyBsaW1pdDogbnVtYmVyKSB7fVxuXG4gIGFzeW5jIHJlYWQocDogVWludDhBcnJheSk6IFByb21pc2U8bnVtYmVyIHwgbnVsbD4ge1xuICAgIGlmICh0aGlzLmxpbWl0IDw9IDApIHtcbiAgICAgIHJldHVybiBudWxsO1xuICAgIH1cblxuICAgIGlmIChwLmxlbmd0aCA+IHRoaXMubGltaXQpIHtcbiAgICAgIHAgPSBwLnN1YmFycmF5KDAsIHRoaXMubGltaXQpO1xuICAgIH1cbiAgICBjb25zdCBuID0gYXdhaXQgdGhpcy5yZWFkZXIucmVhZChwKTtcbiAgICBpZiAobiA9PSBudWxsKSB7XG4gICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG5cbiAgICB0aGlzLmxpbWl0IC09IG47XG4gICAgcmV0dXJuIG47XG4gIH1cbn1cbiJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxFQUEwRSxBQUExRSx3RUFBMEU7QUFDMUUsRUFBbUcsQUFBbkcsaUdBQW1HO0FBQ25HLEVBQXNELEFBQXRELG9EQUFzRDtBQUN0RCxFQUFxRCxBQUFyRCxtREFBcUQ7QUFDckQsRUFBaUQsQUFBakQsK0NBQWlEO0FBRWpELE1BQU0sR0FBRyxNQUFNLFFBQVEsQ0FBYTtBQUVwQyxFQUFpQyxBQUFqQyw2QkFBaUMsQUFBakMsRUFBaUMsQ0FDakMsTUFBTSxPQUFPLFlBQVksU0FBUyxNQUFNO2dCQUMxQixDQUFTLENBQUUsQ0FBQztRQUN0QixLQUFLLENBQUMsR0FBRyxDQUFDLFdBQVcsR0FBRyxNQUFNLENBQUMsQ0FBQyxFQUFFLE1BQU07SUFDMUMsQ0FBQzs7QUFHSCxFQUFvRCxBQUFwRCxnREFBb0QsQUFBcEQsRUFBb0QsQ0FDcEQsTUFBTSxPQUFPLFdBQVc7SUFDTCxPQUFPO0lBQ2hCLFlBQVksR0FBRyxDQUFDO21CQUVULE9BQU8sQ0FBaUIsQ0FBQztRQUN0QyxJQUFJLENBQUMsT0FBTyxHQUFHLE9BQU87SUFDeEIsQ0FBQztVQUVLLElBQUksQ0FBQyxDQUFhLEVBQTBCLENBQUM7UUFDakQsS0FBSyxDQUFDLENBQUMsR0FBRyxJQUFJLENBQUMsT0FBTyxDQUFDLElBQUksQ0FBQyxZQUFZO1FBQ3hDLEVBQUUsR0FBRyxDQUFDLEVBQUUsTUFBTSxDQUFDLElBQUk7UUFDbkIsS0FBSyxDQUFDLE1BQU0sR0FBRyxLQUFLLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDO1FBQzdCLEVBQUUsRUFBRSxNQUFNLEtBQUssSUFBSSxFQUFFLENBQUM7WUFDcEIsSUFBSSxDQUFDLFlBQVk7WUFDakIsTUFBTSxDQUFDLENBQUM7UUFDVixDQUFDO1FBQ0QsTUFBTSxDQUFDLE1BQU07SUFDZixDQUFDOztBQUdILEVBS0csQUFMSDs7Ozs7Q0FLRyxBQUxILEVBS0csQ0FDSCxNQUFNLE9BQU8sYUFBYTtJQUNMLE1BQW1CO0lBQVMsS0FBYTtnQkFBekMsTUFBbUIsRUFBUyxLQUFhLENBQUUsQ0FBQzthQUE1QyxNQUFtQixHQUFuQixNQUFtQjthQUFTLEtBQWEsR0FBYixLQUFhO0lBQUcsQ0FBQztVQUUxRCxJQUFJLENBQUMsQ0FBYSxFQUEwQixDQUFDO1FBQ2pELEVBQUUsRUFBRSxJQUFJLENBQUMsS0FBSyxJQUFJLENBQUMsRUFBRSxDQUFDO1lBQ3BCLE1BQU0sQ0FBQyxJQUFJO1FBQ2IsQ0FBQztRQUVELEVBQUUsRUFBRSxDQUFDLENBQUMsTUFBTSxHQUFHLElBQUksQ0FBQyxLQUFLLEVBQUUsQ0FBQztZQUMxQixDQUFDLEdBQUcsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxDQUFDLEVBQUUsSUFBSSxDQUFDLEtBQUs7UUFDOUIsQ0FBQztRQUNELEtBQUssQ0FBQyxDQUFDLEdBQUcsS0FBSyxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLENBQUM7UUFDbEMsRUFBRSxFQUFFLENBQUMsSUFBSSxJQUFJLEVBQUUsQ0FBQztZQUNkLE1BQU0sQ0FBQyxJQUFJO1FBQ2IsQ0FBQztRQUVELElBQUksQ0FBQyxLQUFLLElBQUksQ0FBQztRQUNmLE1BQU0sQ0FBQyxDQUFDO0lBQ1YsQ0FBQyJ9