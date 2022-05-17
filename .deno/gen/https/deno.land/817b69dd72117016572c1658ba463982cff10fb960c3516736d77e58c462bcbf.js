// Copyright 2018-2021 the Deno authors. All rights reserved. MIT license.
// This program serves files in the current directory over HTTP.
// TODO(bartlomieju): Stream responses instead of reading them into memory.
// TODO(bartlomieju): Add tests like these:
// https://github.com/indexzero/http-server/blob/master/test/http-server-test.js
import { extname, posix } from "../path/mod.ts";
import { listenAndServe, listenAndServeTLS } from "./server.ts";
import { parse } from "../flags/mod.ts";
import { assert } from "../_util/assert.ts";
const encoder = new TextEncoder();
const serverArgs = parse(Deno.args);
const target = posix.resolve(serverArgs._[0] ?? "");
const MEDIA_TYPES = {
    ".md": "text/markdown",
    ".html": "text/html",
    ".htm": "text/html",
    ".json": "application/json",
    ".map": "application/json",
    ".txt": "text/plain",
    ".ts": "text/typescript",
    ".tsx": "text/tsx",
    ".js": "application/javascript",
    ".jsx": "text/jsx",
    ".gz": "application/gzip",
    ".css": "text/css",
    ".wasm": "application/wasm",
    ".mjs": "application/javascript",
    ".svg": "image/svg+xml"
};
/** Returns the content-type based on the extension of a path. */ function contentType(path) {
    return MEDIA_TYPES[extname(path)];
}
function modeToString(isDir, maybeMode) {
    const modeMap = [
        "---",
        "--x",
        "-w-",
        "-wx",
        "r--",
        "r-x",
        "rw-",
        "rwx"
    ];
    if (maybeMode === null) {
        return "(unknown mode)";
    }
    const mode = maybeMode.toString(8);
    if (mode.length < 3) {
        return "(unknown mode)";
    }
    let output = "";
    mode.split("").reverse().slice(0, 3).forEach((v)=>{
        output = modeMap[+v] + output;
    });
    output = `(${isDir ? "d" : "-"}${output})`;
    return output;
}
function fileLenToString(len) {
    const multiplier = 1024;
    let base = 1;
    const suffix = [
        "B",
        "K",
        "M",
        "G",
        "T"
    ];
    let suffixIndex = 0;
    while(base * multiplier < len){
        if (suffixIndex >= suffix.length - 1) {
            break;
        }
        base *= multiplier;
        suffixIndex++;
    }
    return `${(len / base).toFixed(2)}${suffix[suffixIndex]}`;
}
/**
 * Returns an HTTP Response with the requested file as the body
 * @param req The server request context used to cleanup the file handle
 * @param filePath Path of the file to serve
 */ export async function serveFile(req, filePath) {
    const [file, fileInfo] = await Promise.all([
        Deno.open(filePath),
        Deno.stat(filePath), 
    ]);
    const headers = new Headers();
    headers.set("content-length", fileInfo.size.toString());
    const contentTypeValue = contentType(filePath);
    if (contentTypeValue) {
        headers.set("content-type", contentTypeValue);
    }
    req.done.then(()=>{
        file.close();
    });
    return {
        status: 200,
        body: file,
        headers
    };
}
// TODO(bartlomieju): simplify this after deno.stat and deno.readDir are fixed
async function serveDir(req, dirPath) {
    const showDotfiles = serverArgs.dotfiles ?? true;
    const dirUrl = `/${posix.relative(target, dirPath)}`;
    const listEntry = [];
    // if ".." makes sense
    if (dirUrl !== "/") {
        const prevPath = posix.join(dirPath, "..");
        const fileInfo = await Deno.stat(prevPath);
        listEntry.push({
            mode: modeToString(true, fileInfo.mode),
            size: "",
            name: "../",
            url: posix.join(dirUrl, "..")
        });
    }
    for await (const entry of Deno.readDir(dirPath)){
        if (!showDotfiles && entry.name[0] === ".") {
            continue;
        }
        const filePath = posix.join(dirPath, entry.name);
        const fileUrl = posix.join(dirUrl, entry.name);
        if (entry.name === "index.html" && entry.isFile) {
            // in case index.html as dir...
            return serveFile(req, filePath);
        }
        const fileInfo = await Deno.stat(filePath);
        listEntry.push({
            mode: modeToString(entry.isDirectory, fileInfo.mode),
            size: entry.isFile ? fileLenToString(fileInfo.size ?? 0) : "",
            name: `${entry.name}${entry.isDirectory ? "/" : ""}`,
            url: `${fileUrl}${entry.isDirectory ? "/" : ""}`
        });
    }
    listEntry.sort((a, b)=>a.name.toLowerCase() > b.name.toLowerCase() ? 1 : -1
    );
    const formattedDirUrl = `${dirUrl.replace(/\/$/, "")}/`;
    const page = encoder.encode(dirViewerTemplate(formattedDirUrl, listEntry));
    const headers = new Headers();
    headers.set("content-type", "text/html");
    const res = {
        status: 200,
        body: page,
        headers
    };
    return res;
}
function serveFallback(_req, e) {
    if (e instanceof URIError) {
        return Promise.resolve({
            status: 400,
            body: encoder.encode("Bad Request")
        });
    } else if (e instanceof Deno.errors.NotFound) {
        return Promise.resolve({
            status: 404,
            body: encoder.encode("Not Found")
        });
    } else {
        return Promise.resolve({
            status: 500,
            body: encoder.encode("Internal server error")
        });
    }
}
function serverLog(req, res) {
    const d = new Date().toISOString();
    const dateFmt = `[${d.slice(0, 10)} ${d.slice(11, 19)}]`;
    const s = `${dateFmt} "${req.method} ${req.url} ${req.proto}" ${res.status}`;
    console.log(s);
}
function setCORS(res) {
    if (!res.headers) {
        res.headers = new Headers();
    }
    res.headers.append("access-control-allow-origin", "*");
    res.headers.append("access-control-allow-headers", "Origin, X-Requested-With, Content-Type, Accept, Range");
}
function dirViewerTemplate(dirname, entries) {
    return html`
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta http-equiv="X-UA-Compatible" content="ie=edge" />
        <title>Deno File Server</title>
        <style>
          :root {
            --background-color: #fafafa;
            --color: rgba(0, 0, 0, 0.87);
          }
          @media (prefers-color-scheme: dark) {
            :root {
              --background-color: #303030;
              --color: #fff;
            }
          }
          @media (min-width: 960px) {
            main {
              max-width: 960px;
            }
            body {
              padding-left: 32px;
              padding-right: 32px;
            }
          }
          @media (min-width: 600px) {
            main {
              padding-left: 24px;
              padding-right: 24px;
            }
          }
          body {
            background: var(--background-color);
            color: var(--color);
            font-family: "Roboto", "Helvetica", "Arial", sans-serif;
            font-weight: 400;
            line-height: 1.43;
            font-size: 0.875rem;
          }
          a {
            color: #2196f3;
            text-decoration: none;
          }
          a:hover {
            text-decoration: underline;
          }
          table th {
            text-align: left;
          }
          table td {
            padding: 12px 24px 0 0;
          }
        </style>
      </head>
      <body>
        <main>
          <h1>Index of ${dirname}</h1>
          <table>
            <tr>
              <th>Mode</th>
              <th>Size</th>
              <th>Name</th>
            </tr>
            ${entries.map((entry)=>html`
                  <tr>
                    <td class="mode">
                      ${entry.mode}
                    </td>
                    <td>
                      ${entry.size}
                    </td>
                    <td>
                      <a href="${entry.url}">${entry.name}</a>
                    </td>
                  </tr>
                `
    )}
          </table>
        </main>
      </body>
    </html>
  `;
}
function html(strings, ...values) {
    const l = strings.length - 1;
    let html = "";
    for(let i = 0; i < l; i++){
        let v = values[i];
        if (v instanceof Array) {
            v = v.join("");
        }
        const s = strings[i] + v;
        html += s;
    }
    html += strings[l];
    return html;
}
function normalizeURL(url) {
    let normalizedUrl = url;
    try {
        normalizedUrl = decodeURI(normalizedUrl);
    } catch (e) {
        if (!(e instanceof URIError)) {
            throw e;
        }
    }
    try {
        //allowed per https://www.w3.org/Protocols/rfc2616/rfc2616-sec5.html
        const absoluteURI = new URL(normalizedUrl);
        normalizedUrl = absoluteURI.pathname;
    } catch (e1) {
        if (!(e1 instanceof TypeError)) {
            throw e1;
        }
    }
    if (normalizedUrl[0] !== "/") {
        throw new URIError("The request URI is malformed.");
    }
    normalizedUrl = posix.normalize(normalizedUrl);
    const startOfParams = normalizedUrl.indexOf("?");
    return startOfParams > -1 ? normalizedUrl.slice(0, startOfParams) : normalizedUrl;
}
function main() {
    const CORSEnabled = serverArgs.cors ? true : false;
    const port = (serverArgs.port ?? serverArgs.p) ?? 4507;
    const host = serverArgs.host ?? "0.0.0.0";
    const addr = `${host}:${port}`;
    const tlsOpts = {
    };
    tlsOpts.certFile = (serverArgs.cert ?? serverArgs.c) ?? "";
    tlsOpts.keyFile = (serverArgs.key ?? serverArgs.k) ?? "";
    const dirListingEnabled = serverArgs["dir-listing"] ?? true;
    if (tlsOpts.keyFile || tlsOpts.certFile) {
        if (tlsOpts.keyFile === "" || tlsOpts.certFile === "") {
            console.log("--key and --cert are required for TLS");
            serverArgs.h = true;
        }
    }
    if (serverArgs.h ?? serverArgs.help) {
        console.log(`Deno File Server
    Serves a local directory in HTTP.

  INSTALL:
    deno install --allow-net --allow-read https://deno.land/std/http/file_server.ts

  USAGE:
    file_server [path] [options]

  OPTIONS:
    -h, --help          Prints help information
    -p, --port <PORT>   Set port
    --cors              Enable CORS via the "Access-Control-Allow-Origin" header
    --host     <HOST>   Hostname (default is 0.0.0.0)
    -c, --cert <FILE>   TLS certificate file (enables TLS)
    -k, --key  <FILE>   TLS key file (enables TLS)
    --no-dir-listing    Disable directory listing
    --no-dotfiles       Do not show dotfiles

    All TLS options are required when one is provided.`);
        Deno.exit();
    }
    const handler = async (req)=>{
        let response;
        try {
            const normalizedUrl = normalizeURL(req.url);
            let fsPath = posix.join(target, normalizedUrl);
            if (fsPath.indexOf(target) !== 0) {
                fsPath = target;
            }
            const fileInfo = await Deno.stat(fsPath);
            if (fileInfo.isDirectory) {
                if (dirListingEnabled) {
                    response = await serveDir(req, fsPath);
                } else {
                    throw new Deno.errors.NotFound();
                }
            } else {
                response = await serveFile(req, fsPath);
            }
        } catch (e) {
            console.error(e.message);
            response = await serveFallback(req, e);
        } finally{
            if (CORSEnabled) {
                assert(response);
                setCORS(response);
            }
            serverLog(req, response);
            try {
                await req.respond(response);
            } catch (e) {
                console.error(e.message);
            }
        }
    };
    let proto = "http";
    if (tlsOpts.keyFile || tlsOpts.certFile) {
        proto += "s";
        tlsOpts.hostname = host;
        tlsOpts.port = port;
        listenAndServeTLS(tlsOpts, handler);
    } else {
        listenAndServe(addr, handler);
    }
    console.log(`${proto.toUpperCase()} server listening on ${proto}://${addr}/`);
}
if (import.meta.main) {
    main();
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbImh0dHBzOi8vZGVuby5sYW5kL3N0ZEAwLjk2LjAvaHR0cC9maWxlX3NlcnZlci50cyJdLCJzb3VyY2VzQ29udGVudCI6WyJcbi8vIENvcHlyaWdodCAyMDE4LTIwMjEgdGhlIERlbm8gYXV0aG9ycy4gQWxsIHJpZ2h0cyByZXNlcnZlZC4gTUlUIGxpY2Vuc2UuXG5cbi8vIFRoaXMgcHJvZ3JhbSBzZXJ2ZXMgZmlsZXMgaW4gdGhlIGN1cnJlbnQgZGlyZWN0b3J5IG92ZXIgSFRUUC5cbi8vIFRPRE8oYmFydGxvbWllanUpOiBTdHJlYW0gcmVzcG9uc2VzIGluc3RlYWQgb2YgcmVhZGluZyB0aGVtIGludG8gbWVtb3J5LlxuLy8gVE9ETyhiYXJ0bG9taWVqdSk6IEFkZCB0ZXN0cyBsaWtlIHRoZXNlOlxuLy8gaHR0cHM6Ly9naXRodWIuY29tL2luZGV4emVyby9odHRwLXNlcnZlci9ibG9iL21hc3Rlci90ZXN0L2h0dHAtc2VydmVyLXRlc3QuanNcblxuaW1wb3J0IHsgZXh0bmFtZSwgcG9zaXggfSBmcm9tIFwiLi4vcGF0aC9tb2QudHNcIjtcbmltcG9ydCB7XG4gIEhUVFBTT3B0aW9ucyxcbiAgbGlzdGVuQW5kU2VydmUsXG4gIGxpc3RlbkFuZFNlcnZlVExTLFxuICBSZXNwb25zZSxcbiAgU2VydmVyUmVxdWVzdCxcbn0gZnJvbSBcIi4vc2VydmVyLnRzXCI7XG5pbXBvcnQgeyBwYXJzZSB9IGZyb20gXCIuLi9mbGFncy9tb2QudHNcIjtcbmltcG9ydCB7IGFzc2VydCB9IGZyb20gXCIuLi9fdXRpbC9hc3NlcnQudHNcIjtcblxuaW50ZXJmYWNlIEVudHJ5SW5mbyB7XG4gIG1vZGU6IHN0cmluZztcbiAgc2l6ZTogc3RyaW5nO1xuICB1cmw6IHN0cmluZztcbiAgbmFtZTogc3RyaW5nO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIEZpbGVTZXJ2ZXJBcmdzIHtcbiAgXzogc3RyaW5nW107XG4gIC8vIC1wIC0tcG9ydFxuICBwPzogbnVtYmVyO1xuICBwb3J0PzogbnVtYmVyO1xuICAvLyAtLWNvcnNcbiAgY29ycz86IGJvb2xlYW47XG4gIC8vIC0tbm8tZGlyLWxpc3RpbmdcbiAgXCJkaXItbGlzdGluZ1wiPzogYm9vbGVhbjtcbiAgZG90ZmlsZXM/OiBib29sZWFuO1xuICAvLyAtLWhvc3RcbiAgaG9zdD86IHN0cmluZztcbiAgLy8gLWMgLS1jZXJ0XG4gIGM/OiBzdHJpbmc7XG4gIGNlcnQ/OiBzdHJpbmc7XG4gIC8vIC1rIC0ta2V5XG4gIGs/OiBzdHJpbmc7XG4gIGtleT86IHN0cmluZztcbiAgLy8gLWggLS1oZWxwXG4gIGg/OiBib29sZWFuO1xuICBoZWxwPzogYm9vbGVhbjtcbn1cblxuY29uc3QgZW5jb2RlciA9IG5ldyBUZXh0RW5jb2RlcigpO1xuXG5jb25zdCBzZXJ2ZXJBcmdzID0gcGFyc2UoRGVuby5hcmdzKSBhcyBGaWxlU2VydmVyQXJncztcbmNvbnN0IHRhcmdldCA9IHBvc2l4LnJlc29sdmUoc2VydmVyQXJncy5fWzBdID8/IFwiXCIpO1xuXG5jb25zdCBNRURJQV9UWVBFUzogUmVjb3JkPHN0cmluZywgc3RyaW5nPiA9IHtcbiAgXCIubWRcIjogXCJ0ZXh0L21hcmtkb3duXCIsXG4gIFwiLmh0bWxcIjogXCJ0ZXh0L2h0bWxcIixcbiAgXCIuaHRtXCI6IFwidGV4dC9odG1sXCIsXG4gIFwiLmpzb25cIjogXCJhcHBsaWNhdGlvbi9qc29uXCIsXG4gIFwiLm1hcFwiOiBcImFwcGxpY2F0aW9uL2pzb25cIixcbiAgXCIudHh0XCI6IFwidGV4dC9wbGFpblwiLFxuICBcIi50c1wiOiBcInRleHQvdHlwZXNjcmlwdFwiLFxuICBcIi50c3hcIjogXCJ0ZXh0L3RzeFwiLFxuICBcIi5qc1wiOiBcImFwcGxpY2F0aW9uL2phdmFzY3JpcHRcIixcbiAgXCIuanN4XCI6IFwidGV4dC9qc3hcIixcbiAgXCIuZ3pcIjogXCJhcHBsaWNhdGlvbi9nemlwXCIsXG4gIFwiLmNzc1wiOiBcInRleHQvY3NzXCIsXG4gIFwiLndhc21cIjogXCJhcHBsaWNhdGlvbi93YXNtXCIsXG4gIFwiLm1qc1wiOiBcImFwcGxpY2F0aW9uL2phdmFzY3JpcHRcIixcbiAgXCIuc3ZnXCI6IFwiaW1hZ2Uvc3ZnK3htbFwiLFxufTtcblxuLyoqIFJldHVybnMgdGhlIGNvbnRlbnQtdHlwZSBiYXNlZCBvbiB0aGUgZXh0ZW5zaW9uIG9mIGEgcGF0aC4gKi9cbmZ1bmN0aW9uIGNvbnRlbnRUeXBlKHBhdGg6IHN0cmluZyk6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gIHJldHVybiBNRURJQV9UWVBFU1tleHRuYW1lKHBhdGgpXTtcbn1cblxuZnVuY3Rpb24gbW9kZVRvU3RyaW5nKGlzRGlyOiBib29sZWFuLCBtYXliZU1vZGU6IG51bWJlciB8IG51bGwpOiBzdHJpbmcge1xuICBjb25zdCBtb2RlTWFwID0gW1wiLS0tXCIsIFwiLS14XCIsIFwiLXctXCIsIFwiLXd4XCIsIFwici0tXCIsIFwici14XCIsIFwicnctXCIsIFwicnd4XCJdO1xuXG4gIGlmIChtYXliZU1vZGUgPT09IG51bGwpIHtcbiAgICByZXR1cm4gXCIodW5rbm93biBtb2RlKVwiO1xuICB9XG4gIGNvbnN0IG1vZGUgPSBtYXliZU1vZGUudG9TdHJpbmcoOCk7XG4gIGlmIChtb2RlLmxlbmd0aCA8IDMpIHtcbiAgICByZXR1cm4gXCIodW5rbm93biBtb2RlKVwiO1xuICB9XG4gIGxldCBvdXRwdXQgPSBcIlwiO1xuICBtb2RlXG4gICAgLnNwbGl0KFwiXCIpXG4gICAgLnJldmVyc2UoKVxuICAgIC5zbGljZSgwLCAzKVxuICAgIC5mb3JFYWNoKCh2KTogdm9pZCA9PiB7XG4gICAgICBvdXRwdXQgPSBtb2RlTWFwWyt2XSArIG91dHB1dDtcbiAgICB9KTtcbiAgb3V0cHV0ID0gYCgke2lzRGlyID8gXCJkXCIgOiBcIi1cIn0ke291dHB1dH0pYDtcbiAgcmV0dXJuIG91dHB1dDtcbn1cblxuZnVuY3Rpb24gZmlsZUxlblRvU3RyaW5nKGxlbjogbnVtYmVyKTogc3RyaW5nIHtcbiAgY29uc3QgbXVsdGlwbGllciA9IDEwMjQ7XG4gIGxldCBiYXNlID0gMTtcbiAgY29uc3Qgc3VmZml4ID0gW1wiQlwiLCBcIktcIiwgXCJNXCIsIFwiR1wiLCBcIlRcIl07XG4gIGxldCBzdWZmaXhJbmRleCA9IDA7XG5cbiAgd2hpbGUgKGJhc2UgKiBtdWx0aXBsaWVyIDwgbGVuKSB7XG4gICAgaWYgKHN1ZmZpeEluZGV4ID49IHN1ZmZpeC5sZW5ndGggLSAxKSB7XG4gICAgICBicmVhaztcbiAgICB9XG4gICAgYmFzZSAqPSBtdWx0aXBsaWVyO1xuICAgIHN1ZmZpeEluZGV4Kys7XG4gIH1cblxuICByZXR1cm4gYCR7KGxlbiAvIGJhc2UpLnRvRml4ZWQoMil9JHtzdWZmaXhbc3VmZml4SW5kZXhdfWA7XG59XG5cbi8qKlxuICogUmV0dXJucyBhbiBIVFRQIFJlc3BvbnNlIHdpdGggdGhlIHJlcXVlc3RlZCBmaWxlIGFzIHRoZSBib2R5XG4gKiBAcGFyYW0gcmVxIFRoZSBzZXJ2ZXIgcmVxdWVzdCBjb250ZXh0IHVzZWQgdG8gY2xlYW51cCB0aGUgZmlsZSBoYW5kbGVcbiAqIEBwYXJhbSBmaWxlUGF0aCBQYXRoIG9mIHRoZSBmaWxlIHRvIHNlcnZlXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBzZXJ2ZUZpbGUoXG4gIHJlcTogU2VydmVyUmVxdWVzdCxcbiAgZmlsZVBhdGg6IHN0cmluZyxcbik6IFByb21pc2U8UmVzcG9uc2U+IHtcbiAgY29uc3QgW2ZpbGUsIGZpbGVJbmZvXSA9IGF3YWl0IFByb21pc2UuYWxsKFtcbiAgICBEZW5vLm9wZW4oZmlsZVBhdGgpLFxuICAgIERlbm8uc3RhdChmaWxlUGF0aCksXG4gIF0pO1xuICBjb25zdCBoZWFkZXJzID0gbmV3IEhlYWRlcnMoKTtcbiAgaGVhZGVycy5zZXQoXCJjb250ZW50LWxlbmd0aFwiLCBmaWxlSW5mby5zaXplLnRvU3RyaW5nKCkpO1xuICBjb25zdCBjb250ZW50VHlwZVZhbHVlID0gY29udGVudFR5cGUoZmlsZVBhdGgpO1xuICBpZiAoY29udGVudFR5cGVWYWx1ZSkge1xuICAgIGhlYWRlcnMuc2V0KFwiY29udGVudC10eXBlXCIsIGNvbnRlbnRUeXBlVmFsdWUpO1xuICB9XG4gIHJlcS5kb25lLnRoZW4oKCkgPT4ge1xuICAgIGZpbGUuY2xvc2UoKTtcbiAgfSk7XG4gIHJldHVybiB7XG4gICAgc3RhdHVzOiAyMDAsXG4gICAgYm9keTogZmlsZSxcbiAgICBoZWFkZXJzLFxuICB9O1xufVxuXG4vLyBUT0RPKGJhcnRsb21pZWp1KTogc2ltcGxpZnkgdGhpcyBhZnRlciBkZW5vLnN0YXQgYW5kIGRlbm8ucmVhZERpciBhcmUgZml4ZWRcbmFzeW5jIGZ1bmN0aW9uIHNlcnZlRGlyKFxuICByZXE6IFNlcnZlclJlcXVlc3QsXG4gIGRpclBhdGg6IHN0cmluZyxcbik6IFByb21pc2U8UmVzcG9uc2U+IHtcbiAgY29uc3Qgc2hvd0RvdGZpbGVzID0gc2VydmVyQXJncy5kb3RmaWxlcyA/PyB0cnVlO1xuICBjb25zdCBkaXJVcmwgPSBgLyR7cG9zaXgucmVsYXRpdmUodGFyZ2V0LCBkaXJQYXRoKX1gO1xuICBjb25zdCBsaXN0RW50cnk6IEVudHJ5SW5mb1tdID0gW107XG5cbiAgLy8gaWYgXCIuLlwiIG1ha2VzIHNlbnNlXG4gIGlmIChkaXJVcmwgIT09IFwiL1wiKSB7XG4gICAgY29uc3QgcHJldlBhdGggPSBwb3NpeC5qb2luKGRpclBhdGgsIFwiLi5cIik7XG4gICAgY29uc3QgZmlsZUluZm8gPSBhd2FpdCBEZW5vLnN0YXQocHJldlBhdGgpO1xuICAgIGxpc3RFbnRyeS5wdXNoKHtcbiAgICAgIG1vZGU6IG1vZGVUb1N0cmluZyh0cnVlLCBmaWxlSW5mby5tb2RlKSxcbiAgICAgIHNpemU6IFwiXCIsXG4gICAgICBuYW1lOiBcIi4uL1wiLFxuICAgICAgdXJsOiBwb3NpeC5qb2luKGRpclVybCwgXCIuLlwiKSxcbiAgICB9KTtcbiAgfVxuXG4gIGZvciBhd2FpdCAoY29uc3QgZW50cnkgb2YgRGVuby5yZWFkRGlyKGRpclBhdGgpKSB7XG4gICAgaWYgKCFzaG93RG90ZmlsZXMgJiYgZW50cnkubmFtZVswXSA9PT0gXCIuXCIpIHtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBjb25zdCBmaWxlUGF0aCA9IHBvc2l4LmpvaW4oZGlyUGF0aCwgZW50cnkubmFtZSk7XG4gICAgY29uc3QgZmlsZVVybCA9IHBvc2l4LmpvaW4oZGlyVXJsLCBlbnRyeS5uYW1lKTtcbiAgICBpZiAoZW50cnkubmFtZSA9PT0gXCJpbmRleC5odG1sXCIgJiYgZW50cnkuaXNGaWxlKSB7XG4gICAgICAvLyBpbiBjYXNlIGluZGV4Lmh0bWwgYXMgZGlyLi4uXG4gICAgICByZXR1cm4gc2VydmVGaWxlKHJlcSwgZmlsZVBhdGgpO1xuICAgIH1cbiAgICBjb25zdCBmaWxlSW5mbyA9IGF3YWl0IERlbm8uc3RhdChmaWxlUGF0aCk7XG4gICAgbGlzdEVudHJ5LnB1c2goe1xuICAgICAgbW9kZTogbW9kZVRvU3RyaW5nKGVudHJ5LmlzRGlyZWN0b3J5LCBmaWxlSW5mby5tb2RlKSxcbiAgICAgIHNpemU6IGVudHJ5LmlzRmlsZSA/IGZpbGVMZW5Ub1N0cmluZyhmaWxlSW5mby5zaXplID8/IDApIDogXCJcIixcbiAgICAgIG5hbWU6IGAke2VudHJ5Lm5hbWV9JHtlbnRyeS5pc0RpcmVjdG9yeSA/IFwiL1wiIDogXCJcIn1gLFxuICAgICAgdXJsOiBgJHtmaWxlVXJsfSR7ZW50cnkuaXNEaXJlY3RvcnkgPyBcIi9cIiA6IFwiXCJ9YCxcbiAgICB9KTtcbiAgfVxuICBsaXN0RW50cnkuc29ydCgoYSwgYikgPT5cbiAgICBhLm5hbWUudG9Mb3dlckNhc2UoKSA+IGIubmFtZS50b0xvd2VyQ2FzZSgpID8gMSA6IC0xXG4gICk7XG4gIGNvbnN0IGZvcm1hdHRlZERpclVybCA9IGAke2RpclVybC5yZXBsYWNlKC9cXC8kLywgXCJcIil9L2A7XG4gIGNvbnN0IHBhZ2UgPSBlbmNvZGVyLmVuY29kZShkaXJWaWV3ZXJUZW1wbGF0ZShmb3JtYXR0ZWREaXJVcmwsIGxpc3RFbnRyeSkpO1xuXG4gIGNvbnN0IGhlYWRlcnMgPSBuZXcgSGVhZGVycygpO1xuICBoZWFkZXJzLnNldChcImNvbnRlbnQtdHlwZVwiLCBcInRleHQvaHRtbFwiKTtcblxuICBjb25zdCByZXMgPSB7XG4gICAgc3RhdHVzOiAyMDAsXG4gICAgYm9keTogcGFnZSxcbiAgICBoZWFkZXJzLFxuICB9O1xuICByZXR1cm4gcmVzO1xufVxuXG5mdW5jdGlvbiBzZXJ2ZUZhbGxiYWNrKF9yZXE6IFNlcnZlclJlcXVlc3QsIGU6IEVycm9yKTogUHJvbWlzZTxSZXNwb25zZT4ge1xuICBpZiAoZSBpbnN0YW5jZW9mIFVSSUVycm9yKSB7XG4gICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSh7XG4gICAgICBzdGF0dXM6IDQwMCxcbiAgICAgIGJvZHk6IGVuY29kZXIuZW5jb2RlKFwiQmFkIFJlcXVlc3RcIiksXG4gICAgfSk7XG4gIH0gZWxzZSBpZiAoZSBpbnN0YW5jZW9mIERlbm8uZXJyb3JzLk5vdEZvdW5kKSB7XG4gICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSh7XG4gICAgICBzdGF0dXM6IDQwNCxcbiAgICAgIGJvZHk6IGVuY29kZXIuZW5jb2RlKFwiTm90IEZvdW5kXCIpLFxuICAgIH0pO1xuICB9IGVsc2Uge1xuICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoe1xuICAgICAgc3RhdHVzOiA1MDAsXG4gICAgICBib2R5OiBlbmNvZGVyLmVuY29kZShcIkludGVybmFsIHNlcnZlciBlcnJvclwiKSxcbiAgICB9KTtcbiAgfVxufVxuXG5mdW5jdGlvbiBzZXJ2ZXJMb2cocmVxOiBTZXJ2ZXJSZXF1ZXN0LCByZXM6IFJlc3BvbnNlKTogdm9pZCB7XG4gIGNvbnN0IGQgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCk7XG4gIGNvbnN0IGRhdGVGbXQgPSBgWyR7ZC5zbGljZSgwLCAxMCl9ICR7ZC5zbGljZSgxMSwgMTkpfV1gO1xuICBjb25zdCBzID0gYCR7ZGF0ZUZtdH0gXCIke3JlcS5tZXRob2R9ICR7cmVxLnVybH0gJHtyZXEucHJvdG99XCIgJHtyZXMuc3RhdHVzfWA7XG4gIGNvbnNvbGUubG9nKHMpO1xufVxuXG5mdW5jdGlvbiBzZXRDT1JTKHJlczogUmVzcG9uc2UpOiB2b2lkIHtcbiAgaWYgKCFyZXMuaGVhZGVycykge1xuICAgIHJlcy5oZWFkZXJzID0gbmV3IEhlYWRlcnMoKTtcbiAgfVxuICByZXMuaGVhZGVycy5hcHBlbmQoXCJhY2Nlc3MtY29udHJvbC1hbGxvdy1vcmlnaW5cIiwgXCIqXCIpO1xuICByZXMuaGVhZGVycy5hcHBlbmQoXG4gICAgXCJhY2Nlc3MtY29udHJvbC1hbGxvdy1oZWFkZXJzXCIsXG4gICAgXCJPcmlnaW4sIFgtUmVxdWVzdGVkLVdpdGgsIENvbnRlbnQtVHlwZSwgQWNjZXB0LCBSYW5nZVwiLFxuICApO1xufVxuXG5mdW5jdGlvbiBkaXJWaWV3ZXJUZW1wbGF0ZShkaXJuYW1lOiBzdHJpbmcsIGVudHJpZXM6IEVudHJ5SW5mb1tdKTogc3RyaW5nIHtcbiAgcmV0dXJuIGh0bWxgXG4gICAgPCFET0NUWVBFIGh0bWw+XG4gICAgPGh0bWwgbGFuZz1cImVuXCI+XG4gICAgICA8aGVhZD5cbiAgICAgICAgPG1ldGEgY2hhcnNldD1cIlVURi04XCIgLz5cbiAgICAgICAgPG1ldGEgbmFtZT1cInZpZXdwb3J0XCIgY29udGVudD1cIndpZHRoPWRldmljZS13aWR0aCwgaW5pdGlhbC1zY2FsZT0xLjBcIiAvPlxuICAgICAgICA8bWV0YSBodHRwLWVxdWl2PVwiWC1VQS1Db21wYXRpYmxlXCIgY29udGVudD1cImllPWVkZ2VcIiAvPlxuICAgICAgICA8dGl0bGU+RGVubyBGaWxlIFNlcnZlcjwvdGl0bGU+XG4gICAgICAgIDxzdHlsZT5cbiAgICAgICAgICA6cm9vdCB7XG4gICAgICAgICAgICAtLWJhY2tncm91bmQtY29sb3I6ICNmYWZhZmE7XG4gICAgICAgICAgICAtLWNvbG9yOiByZ2JhKDAsIDAsIDAsIDAuODcpO1xuICAgICAgICAgIH1cbiAgICAgICAgICBAbWVkaWEgKHByZWZlcnMtY29sb3Itc2NoZW1lOiBkYXJrKSB7XG4gICAgICAgICAgICA6cm9vdCB7XG4gICAgICAgICAgICAgIC0tYmFja2dyb3VuZC1jb2xvcjogIzMwMzAzMDtcbiAgICAgICAgICAgICAgLS1jb2xvcjogI2ZmZjtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgICAgQG1lZGlhIChtaW4td2lkdGg6IDk2MHB4KSB7XG4gICAgICAgICAgICBtYWluIHtcbiAgICAgICAgICAgICAgbWF4LXdpZHRoOiA5NjBweDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGJvZHkge1xuICAgICAgICAgICAgICBwYWRkaW5nLWxlZnQ6IDMycHg7XG4gICAgICAgICAgICAgIHBhZGRpbmctcmlnaHQ6IDMycHg7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICAgIEBtZWRpYSAobWluLXdpZHRoOiA2MDBweCkge1xuICAgICAgICAgICAgbWFpbiB7XG4gICAgICAgICAgICAgIHBhZGRpbmctbGVmdDogMjRweDtcbiAgICAgICAgICAgICAgcGFkZGluZy1yaWdodDogMjRweDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgICAgYm9keSB7XG4gICAgICAgICAgICBiYWNrZ3JvdW5kOiB2YXIoLS1iYWNrZ3JvdW5kLWNvbG9yKTtcbiAgICAgICAgICAgIGNvbG9yOiB2YXIoLS1jb2xvcik7XG4gICAgICAgICAgICBmb250LWZhbWlseTogXCJSb2JvdG9cIiwgXCJIZWx2ZXRpY2FcIiwgXCJBcmlhbFwiLCBzYW5zLXNlcmlmO1xuICAgICAgICAgICAgZm9udC13ZWlnaHQ6IDQwMDtcbiAgICAgICAgICAgIGxpbmUtaGVpZ2h0OiAxLjQzO1xuICAgICAgICAgICAgZm9udC1zaXplOiAwLjg3NXJlbTtcbiAgICAgICAgICB9XG4gICAgICAgICAgYSB7XG4gICAgICAgICAgICBjb2xvcjogIzIxOTZmMztcbiAgICAgICAgICAgIHRleHQtZGVjb3JhdGlvbjogbm9uZTtcbiAgICAgICAgICB9XG4gICAgICAgICAgYTpob3ZlciB7XG4gICAgICAgICAgICB0ZXh0LWRlY29yYXRpb246IHVuZGVybGluZTtcbiAgICAgICAgICB9XG4gICAgICAgICAgdGFibGUgdGgge1xuICAgICAgICAgICAgdGV4dC1hbGlnbjogbGVmdDtcbiAgICAgICAgICB9XG4gICAgICAgICAgdGFibGUgdGQge1xuICAgICAgICAgICAgcGFkZGluZzogMTJweCAyNHB4IDAgMDtcbiAgICAgICAgICB9XG4gICAgICAgIDwvc3R5bGU+XG4gICAgICA8L2hlYWQ+XG4gICAgICA8Ym9keT5cbiAgICAgICAgPG1haW4+XG4gICAgICAgICAgPGgxPkluZGV4IG9mICR7ZGlybmFtZX08L2gxPlxuICAgICAgICAgIDx0YWJsZT5cbiAgICAgICAgICAgIDx0cj5cbiAgICAgICAgICAgICAgPHRoPk1vZGU8L3RoPlxuICAgICAgICAgICAgICA8dGg+U2l6ZTwvdGg+XG4gICAgICAgICAgICAgIDx0aD5OYW1lPC90aD5cbiAgICAgICAgICAgIDwvdHI+XG4gICAgICAgICAgICAke1xuICAgIGVudHJpZXMubWFwKFxuICAgICAgKGVudHJ5KSA9PlxuICAgICAgICBodG1sYFxuICAgICAgICAgICAgICAgICAgPHRyPlxuICAgICAgICAgICAgICAgICAgICA8dGQgY2xhc3M9XCJtb2RlXCI+XG4gICAgICAgICAgICAgICAgICAgICAgJHtlbnRyeS5tb2RlfVxuICAgICAgICAgICAgICAgICAgICA8L3RkPlxuICAgICAgICAgICAgICAgICAgICA8dGQ+XG4gICAgICAgICAgICAgICAgICAgICAgJHtlbnRyeS5zaXplfVxuICAgICAgICAgICAgICAgICAgICA8L3RkPlxuICAgICAgICAgICAgICAgICAgICA8dGQ+XG4gICAgICAgICAgICAgICAgICAgICAgPGEgaHJlZj1cIiR7ZW50cnkudXJsfVwiPiR7ZW50cnkubmFtZX08L2E+XG4gICAgICAgICAgICAgICAgICAgIDwvdGQ+XG4gICAgICAgICAgICAgICAgICA8L3RyPlxuICAgICAgICAgICAgICAgIGAsXG4gICAgKVxuICB9XG4gICAgICAgICAgPC90YWJsZT5cbiAgICAgICAgPC9tYWluPlxuICAgICAgPC9ib2R5PlxuICAgIDwvaHRtbD5cbiAgYDtcbn1cblxuZnVuY3Rpb24gaHRtbChzdHJpbmdzOiBUZW1wbGF0ZVN0cmluZ3NBcnJheSwgLi4udmFsdWVzOiB1bmtub3duW10pOiBzdHJpbmcge1xuICBjb25zdCBsID0gc3RyaW5ncy5sZW5ndGggLSAxO1xuICBsZXQgaHRtbCA9IFwiXCI7XG5cbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBsOyBpKyspIHtcbiAgICBsZXQgdiA9IHZhbHVlc1tpXTtcbiAgICBpZiAodiBpbnN0YW5jZW9mIEFycmF5KSB7XG4gICAgICB2ID0gdi5qb2luKFwiXCIpO1xuICAgIH1cbiAgICBjb25zdCBzID0gc3RyaW5nc1tpXSArIHY7XG4gICAgaHRtbCArPSBzO1xuICB9XG4gIGh0bWwgKz0gc3RyaW5nc1tsXTtcbiAgcmV0dXJuIGh0bWw7XG59XG5cbmZ1bmN0aW9uIG5vcm1hbGl6ZVVSTCh1cmw6IHN0cmluZyk6IHN0cmluZyB7XG4gIGxldCBub3JtYWxpemVkVXJsID0gdXJsO1xuICB0cnkge1xuICAgIG5vcm1hbGl6ZWRVcmwgPSBkZWNvZGVVUkkobm9ybWFsaXplZFVybCk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBpZiAoIShlIGluc3RhbmNlb2YgVVJJRXJyb3IpKSB7XG4gICAgICB0aHJvdyBlO1xuICAgIH1cbiAgfVxuXG4gIHRyeSB7XG4gICAgLy9hbGxvd2VkIHBlciBodHRwczovL3d3dy53My5vcmcvUHJvdG9jb2xzL3JmYzI2MTYvcmZjMjYxNi1zZWM1Lmh0bWxcbiAgICBjb25zdCBhYnNvbHV0ZVVSSSA9IG5ldyBVUkwobm9ybWFsaXplZFVybCk7XG4gICAgbm9ybWFsaXplZFVybCA9IGFic29sdXRlVVJJLnBhdGhuYW1lO1xuICB9IGNhdGNoIChlKSB7IC8vd2Fzbid0IGFuIGFic29sdXRlVVJJXG4gICAgaWYgKCEoZSBpbnN0YW5jZW9mIFR5cGVFcnJvcikpIHtcbiAgICAgIHRocm93IGU7XG4gICAgfVxuICB9XG5cbiAgaWYgKG5vcm1hbGl6ZWRVcmxbMF0gIT09IFwiL1wiKSB7XG4gICAgdGhyb3cgbmV3IFVSSUVycm9yKFwiVGhlIHJlcXVlc3QgVVJJIGlzIG1hbGZvcm1lZC5cIik7XG4gIH1cblxuICBub3JtYWxpemVkVXJsID0gcG9zaXgubm9ybWFsaXplKG5vcm1hbGl6ZWRVcmwpO1xuICBjb25zdCBzdGFydE9mUGFyYW1zID0gbm9ybWFsaXplZFVybC5pbmRleE9mKFwiP1wiKTtcbiAgcmV0dXJuIHN0YXJ0T2ZQYXJhbXMgPiAtMVxuICAgID8gbm9ybWFsaXplZFVybC5zbGljZSgwLCBzdGFydE9mUGFyYW1zKVxuICAgIDogbm9ybWFsaXplZFVybDtcbn1cblxuZnVuY3Rpb24gbWFpbigpOiB2b2lkIHtcbiAgY29uc3QgQ09SU0VuYWJsZWQgPSBzZXJ2ZXJBcmdzLmNvcnMgPyB0cnVlIDogZmFsc2U7XG4gIGNvbnN0IHBvcnQgPSBzZXJ2ZXJBcmdzLnBvcnQgPz8gc2VydmVyQXJncy5wID8/IDQ1MDc7XG4gIGNvbnN0IGhvc3QgPSBzZXJ2ZXJBcmdzLmhvc3QgPz8gXCIwLjAuMC4wXCI7XG4gIGNvbnN0IGFkZHIgPSBgJHtob3N0fToke3BvcnR9YDtcbiAgY29uc3QgdGxzT3B0cyA9IHt9IGFzIEhUVFBTT3B0aW9ucztcbiAgdGxzT3B0cy5jZXJ0RmlsZSA9IHNlcnZlckFyZ3MuY2VydCA/PyBzZXJ2ZXJBcmdzLmMgPz8gXCJcIjtcbiAgdGxzT3B0cy5rZXlGaWxlID0gc2VydmVyQXJncy5rZXkgPz8gc2VydmVyQXJncy5rID8/IFwiXCI7XG4gIGNvbnN0IGRpckxpc3RpbmdFbmFibGVkID0gc2VydmVyQXJnc1tcImRpci1saXN0aW5nXCJdID8/IHRydWU7XG5cbiAgaWYgKHRsc09wdHMua2V5RmlsZSB8fCB0bHNPcHRzLmNlcnRGaWxlKSB7XG4gICAgaWYgKHRsc09wdHMua2V5RmlsZSA9PT0gXCJcIiB8fCB0bHNPcHRzLmNlcnRGaWxlID09PSBcIlwiKSB7XG4gICAgICBjb25zb2xlLmxvZyhcIi0ta2V5IGFuZCAtLWNlcnQgYXJlIHJlcXVpcmVkIGZvciBUTFNcIik7XG4gICAgICBzZXJ2ZXJBcmdzLmggPSB0cnVlO1xuICAgIH1cbiAgfVxuXG4gIGlmIChzZXJ2ZXJBcmdzLmggPz8gc2VydmVyQXJncy5oZWxwKSB7XG4gICAgY29uc29sZS5sb2coYERlbm8gRmlsZSBTZXJ2ZXJcbiAgICBTZXJ2ZXMgYSBsb2NhbCBkaXJlY3RvcnkgaW4gSFRUUC5cblxuICBJTlNUQUxMOlxuICAgIGRlbm8gaW5zdGFsbCAtLWFsbG93LW5ldCAtLWFsbG93LXJlYWQgaHR0cHM6Ly9kZW5vLmxhbmQvc3RkL2h0dHAvZmlsZV9zZXJ2ZXIudHNcblxuICBVU0FHRTpcbiAgICBmaWxlX3NlcnZlciBbcGF0aF0gW29wdGlvbnNdXG5cbiAgT1BUSU9OUzpcbiAgICAtaCwgLS1oZWxwICAgICAgICAgIFByaW50cyBoZWxwIGluZm9ybWF0aW9uXG4gICAgLXAsIC0tcG9ydCA8UE9SVD4gICBTZXQgcG9ydFxuICAgIC0tY29ycyAgICAgICAgICAgICAgRW5hYmxlIENPUlMgdmlhIHRoZSBcIkFjY2Vzcy1Db250cm9sLUFsbG93LU9yaWdpblwiIGhlYWRlclxuICAgIC0taG9zdCAgICAgPEhPU1Q+ICAgSG9zdG5hbWUgKGRlZmF1bHQgaXMgMC4wLjAuMClcbiAgICAtYywgLS1jZXJ0IDxGSUxFPiAgIFRMUyBjZXJ0aWZpY2F0ZSBmaWxlIChlbmFibGVzIFRMUylcbiAgICAtaywgLS1rZXkgIDxGSUxFPiAgIFRMUyBrZXkgZmlsZSAoZW5hYmxlcyBUTFMpXG4gICAgLS1uby1kaXItbGlzdGluZyAgICBEaXNhYmxlIGRpcmVjdG9yeSBsaXN0aW5nXG4gICAgLS1uby1kb3RmaWxlcyAgICAgICBEbyBub3Qgc2hvdyBkb3RmaWxlc1xuXG4gICAgQWxsIFRMUyBvcHRpb25zIGFyZSByZXF1aXJlZCB3aGVuIG9uZSBpcyBwcm92aWRlZC5gKTtcbiAgICBEZW5vLmV4aXQoKTtcbiAgfVxuXG4gIGNvbnN0IGhhbmRsZXIgPSBhc3luYyAocmVxOiBTZXJ2ZXJSZXF1ZXN0KSA9PiB7XG4gICAgbGV0IHJlc3BvbnNlOiBSZXNwb25zZSB8IHVuZGVmaW5lZDtcbiAgICB0cnkge1xuICAgICAgY29uc3Qgbm9ybWFsaXplZFVybCA9IG5vcm1hbGl6ZVVSTChyZXEudXJsKTtcbiAgICAgIGxldCBmc1BhdGggPSBwb3NpeC5qb2luKHRhcmdldCwgbm9ybWFsaXplZFVybCk7XG4gICAgICBpZiAoZnNQYXRoLmluZGV4T2YodGFyZ2V0KSAhPT0gMCkge1xuICAgICAgICBmc1BhdGggPSB0YXJnZXQ7XG4gICAgICB9XG4gICAgICBjb25zdCBmaWxlSW5mbyA9IGF3YWl0IERlbm8uc3RhdChmc1BhdGgpO1xuICAgICAgaWYgKGZpbGVJbmZvLmlzRGlyZWN0b3J5KSB7XG4gICAgICAgIGlmIChkaXJMaXN0aW5nRW5hYmxlZCkge1xuICAgICAgICAgIHJlc3BvbnNlID0gYXdhaXQgc2VydmVEaXIocmVxLCBmc1BhdGgpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHRocm93IG5ldyBEZW5vLmVycm9ycy5Ob3RGb3VuZCgpO1xuICAgICAgICB9XG4gICAgICB9IGVsc2Uge1xuICAgICAgICByZXNwb25zZSA9IGF3YWl0IHNlcnZlRmlsZShyZXEsIGZzUGF0aCk7XG4gICAgICB9XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgY29uc29sZS5lcnJvcihlLm1lc3NhZ2UpO1xuICAgICAgcmVzcG9uc2UgPSBhd2FpdCBzZXJ2ZUZhbGxiYWNrKHJlcSwgZSk7XG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGlmIChDT1JTRW5hYmxlZCkge1xuICAgICAgICBhc3NlcnQocmVzcG9uc2UpO1xuICAgICAgICBzZXRDT1JTKHJlc3BvbnNlKTtcbiAgICAgIH1cbiAgICAgIHNlcnZlckxvZyhyZXEsIHJlc3BvbnNlISk7XG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCByZXEucmVzcG9uZChyZXNwb25zZSEpO1xuICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICBjb25zb2xlLmVycm9yKGUubWVzc2FnZSk7XG4gICAgICB9XG4gICAgfVxuICB9O1xuXG4gIGxldCBwcm90byA9IFwiaHR0cFwiO1xuICBpZiAodGxzT3B0cy5rZXlGaWxlIHx8IHRsc09wdHMuY2VydEZpbGUpIHtcbiAgICBwcm90byArPSBcInNcIjtcbiAgICB0bHNPcHRzLmhvc3RuYW1lID0gaG9zdDtcbiAgICB0bHNPcHRzLnBvcnQgPSBwb3J0O1xuICAgIGxpc3RlbkFuZFNlcnZlVExTKHRsc09wdHMsIGhhbmRsZXIpO1xuICB9IGVsc2Uge1xuICAgIGxpc3RlbkFuZFNlcnZlKGFkZHIsIGhhbmRsZXIpO1xuICB9XG4gIGNvbnNvbGUubG9nKGAke3Byb3RvLnRvVXBwZXJDYXNlKCl9IHNlcnZlciBsaXN0ZW5pbmcgb24gJHtwcm90b306Ly8ke2FkZHJ9L2ApO1xufVxuXG5pZiAoaW1wb3J0Lm1ldGEubWFpbikge1xuICBtYWluKCk7XG59XG4iXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQ0EsRUFBMEUsQUFBMUUsd0VBQTBFO0FBRTFFLEVBQWdFLEFBQWhFLDhEQUFnRTtBQUNoRSxFQUEyRSxBQUEzRSx5RUFBMkU7QUFDM0UsRUFBMkMsQUFBM0MseUNBQTJDO0FBQzNDLEVBQWdGLEFBQWhGLDhFQUFnRjtBQUVoRixNQUFNLEdBQUcsT0FBTyxFQUFFLEtBQUssUUFBUSxDQUFnQjtBQUMvQyxNQUFNLEdBRUosY0FBYyxFQUNkLGlCQUFpQixRQUdaLENBQWE7QUFDcEIsTUFBTSxHQUFHLEtBQUssUUFBUSxDQUFpQjtBQUN2QyxNQUFNLEdBQUcsTUFBTSxRQUFRLENBQW9CO0FBZ0MzQyxLQUFLLENBQUMsT0FBTyxHQUFHLEdBQUcsQ0FBQyxXQUFXO0FBRS9CLEtBQUssQ0FBQyxVQUFVLEdBQUcsS0FBSyxDQUFDLElBQUksQ0FBQyxJQUFJO0FBQ2xDLEtBQUssQ0FBQyxNQUFNLEdBQUcsS0FBSyxDQUFDLE9BQU8s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