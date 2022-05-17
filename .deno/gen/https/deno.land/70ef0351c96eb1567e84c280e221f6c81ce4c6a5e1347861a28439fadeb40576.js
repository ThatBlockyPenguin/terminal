// Copyright 2018-2021 the Deno authors. All rights reserved. MIT license.
// Structured similarly to Go's cookie.go
// https://github.com/golang/go/blob/master/src/net/http/cookie.go
import { assert } from "../_util/assert.ts";
import { toIMF } from "../datetime/mod.ts";
const FIELD_CONTENT_REGEXP = /^(?=[\x20-\x7E]*$)[^()@<>,;:\\"\[\]?={}\s]+$/;
function toString(cookie) {
    if (!cookie.name) {
        return "";
    }
    const out = [];
    validateName(cookie.name);
    validateValue(cookie.name, cookie.value);
    out.push(`${cookie.name}=${cookie.value}`);
    // Fallback for invalid Set-Cookie
    // ref: https://tools.ietf.org/html/draft-ietf-httpbis-cookie-prefixes-00#section-3.1
    if (cookie.name.startsWith("__Secure")) {
        cookie.secure = true;
    }
    if (cookie.name.startsWith("__Host")) {
        cookie.path = "/";
        cookie.secure = true;
        delete cookie.domain;
    }
    if (cookie.secure) {
        out.push("Secure");
    }
    if (cookie.httpOnly) {
        out.push("HttpOnly");
    }
    if (typeof cookie.maxAge === "number" && Number.isInteger(cookie.maxAge)) {
        assert(cookie.maxAge > 0, "Max-Age must be an integer superior to 0");
        out.push(`Max-Age=${cookie.maxAge}`);
    }
    if (cookie.domain) {
        out.push(`Domain=${cookie.domain}`);
    }
    if (cookie.sameSite) {
        out.push(`SameSite=${cookie.sameSite}`);
    }
    if (cookie.path) {
        validatePath(cookie.path);
        out.push(`Path=${cookie.path}`);
    }
    if (cookie.expires) {
        const dateString = toIMF(cookie.expires);
        out.push(`Expires=${dateString}`);
    }
    if (cookie.unparsed) {
        out.push(cookie.unparsed.join("; "));
    }
    return out.join("; ");
}
/**
 * Validate Cookie Name.
 * @param name Cookie name.
 */ function validateName(name) {
    if (name && !FIELD_CONTENT_REGEXP.test(name)) {
        throw new TypeError(`Invalid cookie name: "${name}".`);
    }
}
/**
 * Validate Path Value.
 * @see https://tools.ietf.org/html/rfc6265#section-4.1.2.4
 * @param path Path value.
 */ function validatePath(path) {
    if (path == null) {
        return;
    }
    for(let i = 0; i < path.length; i++){
        const c = path.charAt(i);
        if (c < String.fromCharCode(32) || c > String.fromCharCode(126) || c == ";") {
            throw new Error(path + ": Invalid cookie path char '" + c + "'");
        }
    }
}
/**
 *Validate Cookie Value.
 * @see https://tools.ietf.org/html/rfc6265#section-4.1
 * @param value Cookie value.
 */ function validateValue(name, value) {
    if (value == null || name == null) return;
    for(let i = 0; i < value.length; i++){
        const c = value.charAt(i);
        if (c < String.fromCharCode(33) || c == String.fromCharCode(34) || c == String.fromCharCode(44) || c == String.fromCharCode(59) || c == String.fromCharCode(92) || c == String.fromCharCode(127)) {
            throw new Error("RFC2616 cookie '" + name + "' cannot have '" + c + "' as value");
        }
        if (c > String.fromCharCode(128)) {
            throw new Error("RFC2616 cookie '" + name + "' can only have US-ASCII chars as value" + c.charCodeAt(0).toString(16));
        }
    }
}
/**
 * Parse the cookies of the Server Request
 * @param req An object which has a `headers` property
 */ export function getCookies(req) {
    const cookie = req.headers.get("Cookie");
    if (cookie != null) {
        const out = {
        };
        const c = cookie.split(";");
        for (const kv of c){
            const [cookieKey, ...cookieVal] = kv.split("=");
            assert(cookieKey != null);
            const key = cookieKey.trim();
            out[key] = cookieVal.join("=");
        }
        return out;
    }
    return {
    };
}
/**
 * Set the cookie header properly in the Response
 * @param res An object which has a headers property
 * @param cookie Cookie to set
 *
 * Example:
 *
 * ```ts
 * setCookie(response, { name: 'deno', value: 'runtime',
 *   httpOnly: true, secure: true, maxAge: 2, domain: "deno.land" });
 * ```
 */ export function setCookie(res, cookie) {
    if (!res.headers) {
        res.headers = new Headers();
    }
    // TODO(zekth) : Add proper parsing of Set-Cookie headers
    // Parsing cookie headers to make consistent set-cookie header
    // ref: https://tools.ietf.org/html/rfc6265#section-4.1.1
    const v = toString(cookie);
    if (v) {
        res.headers.append("Set-Cookie", v);
    }
}
/**
 *  Set the cookie header properly in the Response to delete it
 * @param res Server Response
 * @param name Name of the cookie to Delete
 * Example:
 *
 *     deleteCookie(res,'foo');
 */ export function deleteCookie(res, name) {
    setCookie(res, {
        name: name,
        value: "",
        expires: new Date(0)
    });
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbImh0dHBzOi8vZGVuby5sYW5kL3N0ZEAwLjk5LjAvaHR0cC9jb29raWUudHMiXSwic291cmNlc0NvbnRlbnQiOlsiLy8gQ29weXJpZ2h0IDIwMTgtMjAyMSB0aGUgRGVubyBhdXRob3JzLiBBbGwgcmlnaHRzIHJlc2VydmVkLiBNSVQgbGljZW5zZS5cbi8vIFN0cnVjdHVyZWQgc2ltaWxhcmx5IHRvIEdvJ3MgY29va2llLmdvXG4vLyBodHRwczovL2dpdGh1Yi5jb20vZ29sYW5nL2dvL2Jsb2IvbWFzdGVyL3NyYy9uZXQvaHR0cC9jb29raWUuZ29cbmltcG9ydCB7IGFzc2VydCB9IGZyb20gXCIuLi9fdXRpbC9hc3NlcnQudHNcIjtcbmltcG9ydCB7IHRvSU1GIH0gZnJvbSBcIi4uL2RhdGV0aW1lL21vZC50c1wiO1xuXG5leHBvcnQgaW50ZXJmYWNlIENvb2tpZSB7XG4gIC8qKiBOYW1lIG9mIHRoZSBjb29raWUuICovXG4gIG5hbWU6IHN0cmluZztcbiAgLyoqIFZhbHVlIG9mIHRoZSBjb29raWUuICovXG4gIHZhbHVlOiBzdHJpbmc7XG4gIC8qKiBFeHBpcmF0aW9uIGRhdGUgb2YgdGhlIGNvb2tpZS4gKi9cbiAgZXhwaXJlcz86IERhdGU7XG4gIC8qKiBNYXgtQWdlIG9mIHRoZSBDb29raWUuIE11c3QgYmUgaW50ZWdlciBzdXBlcmlvciB0byAwLiAqL1xuICBtYXhBZ2U/OiBudW1iZXI7XG4gIC8qKiBTcGVjaWZpZXMgdGhvc2UgaG9zdHMgdG8gd2hpY2ggdGhlIGNvb2tpZSB3aWxsIGJlIHNlbnQuICovXG4gIGRvbWFpbj86IHN0cmluZztcbiAgLyoqIEluZGljYXRlcyBhIFVSTCBwYXRoIHRoYXQgbXVzdCBleGlzdCBpbiB0aGUgcmVxdWVzdC4gKi9cbiAgcGF0aD86IHN0cmluZztcbiAgLyoqIEluZGljYXRlcyBpZiB0aGUgY29va2llIGlzIG1hZGUgdXNpbmcgU1NMICYgSFRUUFMuICovXG4gIHNlY3VyZT86IGJvb2xlYW47XG4gIC8qKiBJbmRpY2F0ZXMgdGhhdCBjb29raWUgaXMgbm90IGFjY2Vzc2libGUgdmlhIEphdmFTY3JpcHQuICoqL1xuICBodHRwT25seT86IGJvb2xlYW47XG4gIC8qKiBBbGxvd3Mgc2VydmVycyB0byBhc3NlcnQgdGhhdCBhIGNvb2tpZSBvdWdodCBub3QgdG9cbiAgICogYmUgc2VudCBhbG9uZyB3aXRoIGNyb3NzLXNpdGUgcmVxdWVzdHMuICovXG4gIHNhbWVTaXRlPzogXCJTdHJpY3RcIiB8IFwiTGF4XCIgfCBcIk5vbmVcIjtcbiAgLyoqIEFkZGl0aW9uYWwga2V5IHZhbHVlIHBhaXJzIHdpdGggdGhlIGZvcm0gXCJrZXk9dmFsdWVcIiAqL1xuICB1bnBhcnNlZD86IHN0cmluZ1tdO1xufVxuXG5jb25zdCBGSUVMRF9DT05URU5UX1JFR0VYUCA9IC9eKD89W1xceDIwLVxceDdFXSokKVteKClAPD4sOzpcXFxcXCJcXFtcXF0/PXt9XFxzXSskLztcblxuZnVuY3Rpb24gdG9TdHJpbmcoY29va2llOiBDb29raWUpOiBzdHJpbmcge1xuICBpZiAoIWNvb2tpZS5uYW1lKSB7XG4gICAgcmV0dXJuIFwiXCI7XG4gIH1cbiAgY29uc3Qgb3V0OiBzdHJpbmdbXSA9IFtdO1xuICB2YWxpZGF0ZU5hbWUoY29va2llLm5hbWUpO1xuICB2YWxpZGF0ZVZhbHVlKGNvb2tpZS5uYW1lLCBjb29raWUudmFsdWUpO1xuICBvdXQucHVzaChgJHtjb29raWUubmFtZX09JHtjb29raWUudmFsdWV9YCk7XG5cbiAgLy8gRmFsbGJhY2sgZm9yIGludmFsaWQgU2V0LUNvb2tpZVxuICAvLyByZWY6IGh0dHBzOi8vdG9vbHMuaWV0Zi5vcmcvaHRtbC9kcmFmdC1pZXRmLWh0dHBiaXMtY29va2llLXByZWZpeGVzLTAwI3NlY3Rpb24tMy4xXG4gIGlmIChjb29raWUubmFtZS5zdGFydHNXaXRoKFwiX19TZWN1cmVcIikpIHtcbiAgICBjb29raWUuc2VjdXJlID0gdHJ1ZTtcbiAgfVxuICBpZiAoY29va2llLm5hbWUuc3RhcnRzV2l0aChcIl9fSG9zdFwiKSkge1xuICAgIGNvb2tpZS5wYXRoID0gXCIvXCI7XG4gICAgY29va2llLnNlY3VyZSA9IHRydWU7XG4gICAgZGVsZXRlIGNvb2tpZS5kb21haW47XG4gIH1cblxuICBpZiAoY29va2llLnNlY3VyZSkge1xuICAgIG91dC5wdXNoKFwiU2VjdXJlXCIpO1xuICB9XG4gIGlmIChjb29raWUuaHR0cE9ubHkpIHtcbiAgICBvdXQucHVzaChcIkh0dHBPbmx5XCIpO1xuICB9XG4gIGlmICh0eXBlb2YgY29va2llLm1heEFnZSA9PT0gXCJudW1iZXJcIiAmJiBOdW1iZXIuaXNJbnRlZ2VyKGNvb2tpZS5tYXhBZ2UpKSB7XG4gICAgYXNzZXJ0KGNvb2tpZS5tYXhBZ2UgPiAwLCBcIk1heC1BZ2UgbXVzdCBiZSBhbiBpbnRlZ2VyIHN1cGVyaW9yIHRvIDBcIik7XG4gICAgb3V0LnB1c2goYE1heC1BZ2U9JHtjb29raWUubWF4QWdlfWApO1xuICB9XG4gIGlmIChjb29raWUuZG9tYWluKSB7XG4gICAgb3V0LnB1c2goYERvbWFpbj0ke2Nvb2tpZS5kb21haW59YCk7XG4gIH1cbiAgaWYgKGNvb2tpZS5zYW1lU2l0ZSkge1xuICAgIG91dC5wdXNoKGBTYW1lU2l0ZT0ke2Nvb2tpZS5zYW1lU2l0ZX1gKTtcbiAgfVxuICBpZiAoY29va2llLnBhdGgpIHtcbiAgICB2YWxpZGF0ZVBhdGgoY29va2llLnBhdGgpO1xuICAgIG91dC5wdXNoKGBQYXRoPSR7Y29va2llLnBhdGh9YCk7XG4gIH1cbiAgaWYgKGNvb2tpZS5leHBpcmVzKSB7XG4gICAgY29uc3QgZGF0ZVN0cmluZyA9IHRvSU1GKGNvb2tpZS5leHBpcmVzKTtcbiAgICBvdXQucHVzaChgRXhwaXJlcz0ke2RhdGVTdHJpbmd9YCk7XG4gIH1cbiAgaWYgKGNvb2tpZS51bnBhcnNlZCkge1xuICAgIG91dC5wdXNoKGNvb2tpZS51bnBhcnNlZC5qb2luKFwiOyBcIikpO1xuICB9XG4gIHJldHVybiBvdXQuam9pbihcIjsgXCIpO1xufVxuXG4vKipcbiAqIFZhbGlkYXRlIENvb2tpZSBOYW1lLlxuICogQHBhcmFtIG5hbWUgQ29va2llIG5hbWUuXG4gKi9cbmZ1bmN0aW9uIHZhbGlkYXRlTmFtZShuYW1lOiBzdHJpbmcgfCB1bmRlZmluZWQgfCBudWxsKTogdm9pZCB7XG4gIGlmIChuYW1lICYmICFGSUVMRF9DT05URU5UX1JFR0VYUC50ZXN0KG5hbWUpKSB7XG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvcihgSW52YWxpZCBjb29raWUgbmFtZTogXCIke25hbWV9XCIuYCk7XG4gIH1cbn1cblxuLyoqXG4gKiBWYWxpZGF0ZSBQYXRoIFZhbHVlLlxuICogQHNlZSBodHRwczovL3Rvb2xzLmlldGYub3JnL2h0bWwvcmZjNjI2NSNzZWN0aW9uLTQuMS4yLjRcbiAqIEBwYXJhbSBwYXRoIFBhdGggdmFsdWUuXG4gKi9cbmZ1bmN0aW9uIHZhbGlkYXRlUGF0aChwYXRoOiBzdHJpbmcgfCBudWxsKTogdm9pZCB7XG4gIGlmIChwYXRoID09IG51bGwpIHtcbiAgICByZXR1cm47XG4gIH1cbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBwYXRoLmxlbmd0aDsgaSsrKSB7XG4gICAgY29uc3QgYyA9IHBhdGguY2hhckF0KGkpO1xuICAgIGlmIChcbiAgICAgIGMgPCBTdHJpbmcuZnJvbUNoYXJDb2RlKDB4MjApIHx8IGMgPiBTdHJpbmcuZnJvbUNoYXJDb2RlKDB4N0UpIHx8IGMgPT0gXCI7XCJcbiAgICApIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgcGF0aCArIFwiOiBJbnZhbGlkIGNvb2tpZSBwYXRoIGNoYXIgJ1wiICsgYyArIFwiJ1wiLFxuICAgICAgKTtcbiAgICB9XG4gIH1cbn1cblxuLyoqXG4gKlZhbGlkYXRlIENvb2tpZSBWYWx1ZS5cbiAqIEBzZWUgaHR0cHM6Ly90b29scy5pZXRmLm9yZy9odG1sL3JmYzYyNjUjc2VjdGlvbi00LjFcbiAqIEBwYXJhbSB2YWx1ZSBDb29raWUgdmFsdWUuXG4gKi9cbmZ1bmN0aW9uIHZhbGlkYXRlVmFsdWUobmFtZTogc3RyaW5nLCB2YWx1ZTogc3RyaW5nIHwgbnVsbCk6IHZvaWQge1xuICBpZiAodmFsdWUgPT0gbnVsbCB8fCBuYW1lID09IG51bGwpIHJldHVybjtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCB2YWx1ZS5sZW5ndGg7IGkrKykge1xuICAgIGNvbnN0IGMgPSB2YWx1ZS5jaGFyQXQoaSk7XG4gICAgaWYgKFxuICAgICAgYyA8IFN0cmluZy5mcm9tQ2hhckNvZGUoMHgyMSkgfHwgYyA9PSBTdHJpbmcuZnJvbUNoYXJDb2RlKDB4MjIpIHx8XG4gICAgICBjID09IFN0cmluZy5mcm9tQ2hhckNvZGUoMHgyYykgfHwgYyA9PSBTdHJpbmcuZnJvbUNoYXJDb2RlKDB4M2IpIHx8XG4gICAgICBjID09IFN0cmluZy5mcm9tQ2hhckNvZGUoMHg1YykgfHwgYyA9PSBTdHJpbmcuZnJvbUNoYXJDb2RlKDB4N2YpXG4gICAgKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAgIFwiUkZDMjYxNiBjb29raWUgJ1wiICsgbmFtZSArIFwiJyBjYW5ub3QgaGF2ZSAnXCIgKyBjICsgXCInIGFzIHZhbHVlXCIsXG4gICAgICApO1xuICAgIH1cbiAgICBpZiAoYyA+IFN0cmluZy5mcm9tQ2hhckNvZGUoMHg4MCkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgXCJSRkMyNjE2IGNvb2tpZSAnXCIgKyBuYW1lICsgXCInIGNhbiBvbmx5IGhhdmUgVVMtQVNDSUkgY2hhcnMgYXMgdmFsdWVcIiArXG4gICAgICAgICAgYy5jaGFyQ29kZUF0KDApLnRvU3RyaW5nKDE2KSxcbiAgICAgICk7XG4gICAgfVxuICB9XG59XG5cbi8qKlxuICogUGFyc2UgdGhlIGNvb2tpZXMgb2YgdGhlIFNlcnZlciBSZXF1ZXN0XG4gKiBAcGFyYW0gcmVxIEFuIG9iamVjdCB3aGljaCBoYXMgYSBgaGVhZGVyc2AgcHJvcGVydHlcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGdldENvb2tpZXMocmVxOiB7IGhlYWRlcnM6IEhlYWRlcnMgfSk6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4ge1xuICBjb25zdCBjb29raWUgPSByZXEuaGVhZGVycy5nZXQoXCJDb29raWVcIik7XG4gIGlmIChjb29raWUgIT0gbnVsbCkge1xuICAgIGNvbnN0IG91dDogUmVjb3JkPHN0cmluZywgc3RyaW5nPiA9IHt9O1xuICAgIGNvbnN0IGMgPSBjb29raWUuc3BsaXQoXCI7XCIpO1xuICAgIGZvciAoY29uc3Qga3Ygb2YgYykge1xuICAgICAgY29uc3QgW2Nvb2tpZUtleSwgLi4uY29va2llVmFsXSA9IGt2LnNwbGl0KFwiPVwiKTtcbiAgICAgIGFzc2VydChjb29raWVLZXkgIT0gbnVsbCk7XG4gICAgICBjb25zdCBrZXkgPSBjb29raWVLZXkudHJpbSgpO1xuICAgICAgb3V0W2tleV0gPSBjb29raWVWYWwuam9pbihcIj1cIik7XG4gICAgfVxuICAgIHJldHVybiBvdXQ7XG4gIH1cbiAgcmV0dXJuIHt9O1xufVxuXG4vKipcbiAqIFNldCB0aGUgY29va2llIGhlYWRlciBwcm9wZXJseSBpbiB0aGUgUmVzcG9uc2VcbiAqIEBwYXJhbSByZXMgQW4gb2JqZWN0IHdoaWNoIGhhcyBhIGhlYWRlcnMgcHJvcGVydHlcbiAqIEBwYXJhbSBjb29raWUgQ29va2llIHRvIHNldFxuICpcbiAqIEV4YW1wbGU6XG4gKlxuICogYGBgdHNcbiAqIHNldENvb2tpZShyZXNwb25zZSwgeyBuYW1lOiAnZGVubycsIHZhbHVlOiAncnVudGltZScsXG4gKiAgIGh0dHBPbmx5OiB0cnVlLCBzZWN1cmU6IHRydWUsIG1heEFnZTogMiwgZG9tYWluOiBcImRlbm8ubGFuZFwiIH0pO1xuICogYGBgXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzZXRDb29raWUocmVzOiB7IGhlYWRlcnM/OiBIZWFkZXJzIH0sIGNvb2tpZTogQ29va2llKTogdm9pZCB7XG4gIGlmICghcmVzLmhlYWRlcnMpIHtcbiAgICByZXMuaGVhZGVycyA9IG5ldyBIZWFkZXJzKCk7XG4gIH1cbiAgLy8gVE9ETyh6ZWt0aCkgOiBBZGQgcHJvcGVyIHBhcnNpbmcgb2YgU2V0LUNvb2tpZSBoZWFkZXJzXG4gIC8vIFBhcnNpbmcgY29va2llIGhlYWRlcnMgdG8gbWFrZSBjb25zaXN0ZW50IHNldC1jb29raWUgaGVhZGVyXG4gIC8vIHJlZjogaHR0cHM6Ly90b29scy5pZXRmLm9yZy9odG1sL3JmYzYyNjUjc2VjdGlvbi00LjEuMVxuICBjb25zdCB2ID0gdG9TdHJpbmcoY29va2llKTtcbiAgaWYgKHYpIHtcbiAgICByZXMuaGVhZGVycy5hcHBlbmQoXCJTZXQtQ29va2llXCIsIHYpO1xuICB9XG59XG5cbi8qKlxuICogIFNldCB0aGUgY29va2llIGhlYWRlciBwcm9wZXJseSBpbiB0aGUgUmVzcG9uc2UgdG8gZGVsZXRlIGl0XG4gKiBAcGFyYW0gcmVzIFNlcnZlciBSZXNwb25zZVxuICogQHBhcmFtIG5hbWUgTmFtZSBvZiB0aGUgY29va2llIHRvIERlbGV0ZVxuICogRXhhbXBsZTpcbiAqXG4gKiAgICAgZGVsZXRlQ29va2llKHJlcywnZm9vJyk7XG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBkZWxldGVDb29raWUocmVzOiB7IGhlYWRlcnM/OiBIZWFkZXJzIH0sIG5hbWU6IHN0cmluZyk6IHZvaWQge1xuICBzZXRDb29raWUocmVzLCB7XG4gICAgbmFtZTogbmFtZSxcbiAgICB2YWx1ZTogXCJcIixcbiAgICBleHBpcmVzOiBuZXcgRGF0ZSgwKSxcbiAgfSk7XG59XG4iXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsRUFBMEUsQUFBMUUsd0VBQTBFO0FBQzFFLEVBQXlDLEFBQXpDLHVDQUF5QztBQUN6QyxFQUFrRSxBQUFsRSxnRUFBa0U7QUFDbEUsTUFBTSxHQUFHLE1BQU0sUUFBUSxDQUFvQjtBQUMzQyxNQUFNLEdBQUcsS0FBSyxRQUFRLENBQW9CO0FBMEIxQyxLQUFLLENBQUMsb0JBQW9CO1NBRWpCLFFBQVEsQ0FBQyxNQUFjLEVBQVUsQ0FBQztJQUN6QyxFQUFFLEdBQUcsTUFBTSxDQUFDLElB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