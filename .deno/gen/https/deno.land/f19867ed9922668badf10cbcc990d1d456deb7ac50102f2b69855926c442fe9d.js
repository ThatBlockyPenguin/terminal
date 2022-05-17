// Copyright 2018-2021 the Deno authors. All rights reserved. MIT license.
/* Resolves after the given number of milliseconds. */ export function delay(ms) {
    return new Promise((res)=>setTimeout(()=>{
            res();
        }, ms)
    );
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbImh0dHBzOi8vZGVuby5sYW5kL3N0ZEAwLjk5LjAvYXN5bmMvZGVsYXkudHMiXSwic291cmNlc0NvbnRlbnQiOlsiLy8gQ29weXJpZ2h0IDIwMTgtMjAyMSB0aGUgRGVubyBhdXRob3JzLiBBbGwgcmlnaHRzIHJlc2VydmVkLiBNSVQgbGljZW5zZS5cbi8qIFJlc29sdmVzIGFmdGVyIHRoZSBnaXZlbiBudW1iZXIgb2YgbWlsbGlzZWNvbmRzLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGRlbGF5KG1zOiBudW1iZXIpOiBQcm9taXNlPHZvaWQ+IHtcbiAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXMpOiBudW1iZXIgPT5cbiAgICBzZXRUaW1lb3V0KCgpOiB2b2lkID0+IHtcbiAgICAgIHJlcygpO1xuICAgIH0sIG1zKVxuICApO1xufVxuIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLEVBQTBFLEFBQTFFLHdFQUEwRTtBQUMxRSxFQUFzRCxBQUF0RCxrREFBc0QsQUFBdEQsRUFBc0QsQ0FDdEQsTUFBTSxVQUFVLEtBQUssQ0FBQyxFQUFVLEVBQWlCLENBQUM7SUFDaEQsTUFBTSxDQUFDLEdBQUcsQ0FBQyxPQUFPLEVBQUUsR0FBRyxHQUNyQixVQUFVLEtBQWEsQ0FBQztZQUN0QixHQUFHO1FBQ0wsQ0FBQyxFQUFFLEVBQUU7O0FBRVQsQ0FBQyJ9