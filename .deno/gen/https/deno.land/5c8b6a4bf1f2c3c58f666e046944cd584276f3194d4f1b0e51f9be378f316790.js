const { open } = Deno;
import { BufReader } from "./vendor/https/deno.land/std/io/bufio.ts";
import { Buffer } from "./vendor/https/deno.land/std/io/buffer.ts";
import { readAll } from "./vendor/https/deno.land/std/io/util.ts";
import escape from "./vendor/https/deno.land/x/lodash/escape.js";
var ReadMode;
(function (ReadMode) {
    ReadMode[ReadMode["Normal"] = 0] = "Normal";
    ReadMode[ReadMode["Escaped"] = 1] = "Escaped";
    ReadMode[ReadMode["Raw"] = 2] = "Raw";
    ReadMode[ReadMode["Comment"] = 3] = "Comment";
    ReadMode[ReadMode["Evaluate"] = 4] = "Evaluate";
})(ReadMode || (ReadMode = {}));
var Codes;
(function (Codes) {
    Codes[Codes["Begin"] = 60] = "Begin";
    Codes[Codes["End"] = 62] = "End";
    Codes[Codes["Percent"] = 37] = "Percent";
    Codes[Codes["Escaped"] = 61] = "Escaped";
    Codes[Codes["Raw"] = 45] = "Raw";
    Codes[Codes["Comment"] = 35] = "Comment";
})(Codes || (Codes = {}));
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8");
class StringReader extends Buffer {
    constructor(s) {
        super(encoder.encode(s).buffer);
    }
}
async function include(path, params) {
    const result = await renderFile(path, params);
    const buf = new Buffer();
    await buf.readFrom(result);
    return await bufToStr(buf);
}
function sanitize(str) {
    return str.replace(/\`/g, "\\`").replace(/\$/g, "\\$").replace(/\\+$/, "");
}
async function bufToStr(buf) {
    return decoder.decode(await readAll(buf));
}
function removeLastSemi(s) {
    return s.trimRight().replace(/;$/, "");
}
async function bufToStrWithSanitize(buf) {
    return sanitize(await bufToStr(buf));
}
function NewTemplate(script) {
    return async (params) => {
        const output = [];
        await new Promise((resolve, reject) => {
            const args = {
                include,
                ...params,
                $$OUTPUT: output,
                $$FINISHED: resolve,
                $$ERROR: reject,
                $$ESCAPE: escape,
            };
            const src = `(async() => {
        try { ${script} } catch (error) { $$ERROR(error) }
        $$FINISHED();
      })();`;
            const f = new Function(...Object.keys(args), src);
            f(...Object.values(args));
        });
        return output.join("");
    };
}
export async function compile(reader) {
    const src = new BufReader(reader);
    const buf = [];
    const statements = [];
    const statementBuf = new Buffer();
    let readMode = ReadMode.Normal;
    const statementBufWrite = async (byte) => await statementBuf.write(new Uint8Array([byte]));
    while (true) {
        const byte = await src.readByte();
        if (byte === null) {
            break;
        }
        buf.push(byte);
        if (buf.length < 3) {
            continue;
        }
        if (readMode === ReadMode.Normal) {
            if (buf[0] === Codes.Begin && buf[1] === Codes.Percent) {
                switch (buf[2]) {
                    case Codes.Escaped:
                        readMode = ReadMode.Escaped;
                        break;
                    case Codes.Raw:
                        readMode = ReadMode.Raw;
                        break;
                    case Codes.Comment:
                        readMode = ReadMode.Comment;
                        break;
                    default:
                        readMode = ReadMode.Evaluate;
                        break;
                }
                statements.push(`;$$OUTPUT.push(\`${await bufToStrWithSanitize(statementBuf)}\`);`);
                statementBuf.reset();
                buf.splice(0);
                continue;
            }
            if (buf.length > 2) {
                await statementBufWrite(buf.shift());
            }
            continue;
        }
        if (buf[1] === Codes.Percent && buf[2] === Codes.End) {
            statementBufWrite(buf.shift());
            buf.splice(0);
            if (readMode !== ReadMode.Comment) {
                switch (readMode) {
                    case ReadMode.Raw:
                        statements.push(`;$$OUTPUT.push(${removeLastSemi(await bufToStr(statementBuf))});`);
                        break;
                    case ReadMode.Escaped:
                        statements.push(`;$$OUTPUT.push($$ESCAPE(${removeLastSemi(await bufToStr(statementBuf))}));`);
                        break;
                    case ReadMode.Evaluate:
                        statements.push(await bufToStr(statementBuf));
                        break;
                }
            }
            statementBuf.reset();
            readMode = ReadMode.Normal;
            continue;
        }
        await statementBufWrite(buf.shift());
    }
    while (buf.length > 0) {
        await statementBufWrite(buf.shift());
    }
    statements.push(`$$OUTPUT.push(\`${await bufToStrWithSanitize(statementBuf)}\`);`);
    statementBuf.reset();
    return await NewTemplate(statements.join(""));
}
export async function renderToString(body, params) {
    const reader = new StringReader(body);
    const template = await compile(reader);
    return template(params);
}
export async function renderFileToString(path, params) {
    const file = await open(path);
    const template = await compile(file);
    file.close();
    return template(params);
}
export async function render(body, params) {
    const result = await renderToString(body, params);
    return new StringReader(result);
}
export async function renderFile(path, params) {
    const result = await renderFileToString(path, params);
    return new StringReader(result);
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibW9kLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsibW9kLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLE1BQU0sRUFBRSxJQUFJLEVBQUUsR0FBRyxJQUFJLENBQUM7QUFFdEIsT0FBTyxFQUFFLFNBQVMsRUFBRSxNQUFNLDBDQUEwQyxDQUFDO0FBQ3JFLE9BQU8sRUFBRSxNQUFNLEVBQUUsTUFBTSwyQ0FBMkMsQ0FBQztBQUNuRSxPQUFPLEVBQUUsT0FBTyxFQUFFLE1BQU0seUNBQXlDLENBQUM7QUFDbEUsT0FBTyxNQUFNLE1BQU0sNkNBQTZDLENBQUM7QUFPakUsSUFBSyxRQU1KO0FBTkQsV0FBSyxRQUFRO0lBQ1gsMkNBQU0sQ0FBQTtJQUNOLDZDQUFPLENBQUE7SUFDUCxxQ0FBRyxDQUFBO0lBQ0gsNkNBQU8sQ0FBQTtJQUNQLCtDQUFRLENBQUE7QUFDVixDQUFDLEVBTkksUUFBUSxLQUFSLFFBQVEsUUFNWjtBQUVELElBQUssS0FPSjtBQVBELFdBQUssS0FBSztJQUNSLG9DQUFVLENBQUE7SUFDVixnQ0FBUSxDQUFBO0lBQ1Isd0NBQVksQ0FBQTtJQUNaLHdDQUFZLENBQUE7SUFDWixnQ0FBUSxDQUFBO0lBQ1Isd0NBQVksQ0FBQTtBQUNkLENBQUMsRUFQSSxLQUFLLEtBQUwsS0FBSyxRQU9UO0FBTUQsTUFBTSxPQUFPLEdBQUcsSUFBSSxXQUFXLEVBQUUsQ0FBQztBQUNsQyxNQUFNLE9BQU8sR0FBRyxJQUFJLFdBQVcsQ0FBQyxPQUFPLENBQUMsQ0FBQztBQUV6QyxNQUFNLFlBQWEsU0FBUSxNQUFNO0lBQy9CLFlBQVksQ0FBUztRQUNuQixLQUFLLENBQUMsT0FBTyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsQ0FBQztJQUNsQyxDQUFDO0NBQ0Y7QUFFRCxLQUFLLFVBQVUsT0FBTyxDQUFDLElBQVksRUFBRSxNQUFjO0lBQ2pELE1BQU0sTUFBTSxHQUFHLE1BQU0sVUFBVSxDQUFDLElBQUksRUFBRSxNQUFNLENBQUMsQ0FBQztJQUM5QyxNQUFNLEdBQUcsR0FBRyxJQUFJLE1BQU0sRUFBRSxDQUFDO0lBQ3pCLE1BQU0sR0FBRyxDQUFDLFFBQVEsQ0FBQyxNQUFNLENBQUMsQ0FBQztJQUMzQixPQUFPLE1BQU0sUUFBUSxDQUFDLEdBQUcsQ0FBQyxDQUFDO0FBQzdCLENBQUM7QUFFRCxTQUFTLFFBQVEsQ0FBQyxHQUFXO0lBQzNCLE9BQU8sR0FBRyxDQUFDLE9BQU8sQ0FBQyxLQUFLLEVBQUUsS0FBSyxDQUFDLENBQUMsT0FBTyxDQUFDLEtBQUssRUFBRSxLQUFLLENBQUMsQ0FBQyxPQUFPLENBQUMsTUFBTSxFQUFFLEVBQUUsQ0FBQyxDQUFDO0FBQzdFLENBQUM7QUFFRCxLQUFLLFVBQVUsUUFBUSxDQUFDLEdBQVc7SUFDakMsT0FBTyxPQUFPLENBQUMsTUFBTSxDQUFDLE1BQU0sT0FBTyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUM7QUFDNUMsQ0FBQztBQUVELFNBQVMsY0FBYyxDQUFDLENBQVM7SUFDL0IsT0FBTyxDQUFDLENBQUMsU0FBUyxFQUFFLENBQUMsT0FBTyxDQUFDLElBQUksRUFBRSxFQUFFLENBQUMsQ0FBQztBQUN6QyxDQUFDO0FBRUQsS0FBSyxVQUFVLG9CQUFvQixDQUFDLEdBQVc7SUFDN0MsT0FBTyxRQUFRLENBQUMsTUFBTSxRQUFRLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQztBQUN2QyxDQUFDO0FBRUQsU0FBUyxXQUFXLENBQUMsTUFBYztJQUNqQyxPQUFPLEtBQUssRUFBRSxNQUFjLEVBQW1CLEVBQUU7UUFDL0MsTUFBTSxNQUFNLEdBQWtCLEVBQUUsQ0FBQztRQUNqQyxNQUFNLElBQUksT0FBTyxDQUFDLENBQUMsT0FBTyxFQUFFLE1BQU0sRUFBRSxFQUFFO1lBQ3BDLE1BQU0sSUFBSSxHQUFHO2dCQUNYLE9BQU87Z0JBQ1AsR0FBRyxNQUFNO2dCQUNULFFBQVEsRUFBRSxNQUFNO2dCQUNoQixVQUFVLEVBQUUsT0FBTztnQkFDbkIsT0FBTyxFQUFFLE1BQU07Z0JBQ2YsUUFBUSxFQUFFLE1BQU07YUFDakIsQ0FBQztZQUNGLE1BQU0sR0FBRyxHQUFHO2dCQUNGLE1BQU07O1lBRVYsQ0FBQztZQUNQLE1BQU0sQ0FBQyxHQUFHLElBQUksUUFBUSxDQUFDLEdBQUcsTUFBTSxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsRUFBRSxHQUFHLENBQUMsQ0FBQztZQUNsRCxDQUFDLENBQUMsR0FBRyxNQUFNLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUM7UUFDNUIsQ0FBQyxDQUFDLENBQUM7UUFDSCxPQUFPLE1BQU0sQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDLENBQUM7SUFDekIsQ0FBQyxDQUFDO0FBQ0osQ0FBQztBQUVELE1BQU0sQ0FBQyxLQUFLLFVBQVUsT0FBTyxDQUFDLE1BQWM7SUFDMUMsTUFBTSxHQUFHLEdBQUcsSUFBSSxTQUFTLENBQUMsTUFBTSxDQUFDLENBQUM7SUFDbEMsTUFBTSxHQUFHLEdBQWtCLEVBQUUsQ0FBQztJQUM5QixNQUFNLFVBQVUsR0FBa0IsRUFBRSxDQUFDO0lBQ3JDLE1BQU0sWUFBWSxHQUFHLElBQUksTUFBTSxFQUFFLENBQUM7SUFDbEMsSUFBSSxRQUFRLEdBQWEsUUFBUSxDQUFDLE1BQU0sQ0FBQztJQUN6QyxNQUFNLGlCQUFpQixHQUFHLEtBQUssRUFBRSxJQUFZLEVBQW1CLEVBQUUsQ0FDaEUsTUFBTSxZQUFZLENBQUMsS0FBSyxDQUFDLElBQUksVUFBVSxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDO0lBRW5ELE9BQU8sSUFBSSxFQUFFO1FBQ1gsTUFBTSxJQUFJLEdBQUcsTUFBTSxHQUFHLENBQUMsUUFBUSxFQUFFLENBQUM7UUFDbEMsSUFBSSxJQUFJLEtBQUssSUFBSSxFQUFFO1lBQ2pCLE1BQU07U0FDUDtRQUVELEdBQUcsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUM7UUFDZixJQUFJLEdBQUcsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFO1lBQ2xCLFNBQVM7U0FDVjtRQUVELElBQUksUUFBUSxLQUFLLFFBQVEsQ0FBQyxNQUFNLEVBQUU7WUFFaEMsSUFBSSxHQUFHLENBQUMsQ0FBQyxDQUFDLEtBQUssS0FBSyxDQUFDLEtBQUssSUFBSSxHQUFHLENBQUMsQ0FBQyxDQUFDLEtBQUssS0FBSyxDQUFDLE9BQU8sRUFBRTtnQkFDdEQsUUFBUSxHQUFHLENBQUMsQ0FBQyxDQUFDLEVBQUU7b0JBQ2QsS0FBSyxLQUFLLENBQUMsT0FBTzt3QkFDaEIsUUFBUSxHQUFHLFFBQVEsQ0FBQyxPQUFPLENBQUM7d0JBQzVCLE1BQU07b0JBQ1IsS0FBSyxLQUFLLENBQUMsR0FBRzt3QkFDWixRQUFRLEdBQUcsUUFBUSxDQUFDLEdBQUcsQ0FBQzt3QkFDeEIsTUFBTTtvQkFDUixLQUFLLEtBQUssQ0FBQyxPQUFPO3dCQUNoQixRQUFRLEdBQUcsUUFBUSxDQUFDLE9BQU8sQ0FBQzt3QkFDNUIsTUFBTTtvQkFDUjt3QkFDRSxRQUFRLEdBQUcsUUFBUSxDQUFDLFFBQVEsQ0FBQzt3QkFDN0IsTUFBTTtpQkFDVDtnQkFDRCxVQUFVLENBQUMsSUFBSSxDQUNiLG9CQUFvQixNQUFNLG9CQUFvQixDQUFDLFlBQVksQ0FBQyxNQUFNLENBQ25FLENBQUM7Z0JBQ0YsWUFBWSxDQUFDLEtBQUssRUFBRSxDQUFDO2dCQUNyQixHQUFHLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxDQUFDO2dCQUNkLFNBQVM7YUFDVjtZQUNELElBQUksR0FBRyxDQUFDLE1BQU0sR0FBRyxDQUFDLEVBQUU7Z0JBQ2xCLE1BQU0saUJBQWlCLENBQUMsR0FBRyxDQUFDLEtBQUssRUFBWSxDQUFDLENBQUM7YUFDaEQ7WUFDRCxTQUFTO1NBQ1Y7UUFHRCxJQUFJLEdBQUcsQ0FBQyxDQUFDLENBQUMsS0FBSyxLQUFLLENBQUMsT0FBTyxJQUFJLEdBQUcsQ0FBQyxDQUFDLENBQUMsS0FBSyxLQUFLLENBQUMsR0FBRyxFQUFFO1lBQ3BELGlCQUFpQixDQUFDLEdBQUcsQ0FBQyxLQUFLLEVBQVksQ0FBQyxDQUFDO1lBQ3pDLEdBQUcsQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLENBQUM7WUFFZCxJQUFJLFFBQVEsS0FBSyxRQUFRLENBQUMsT0FBTyxFQUFFO2dCQUNqQyxRQUFRLFFBQVEsRUFBRTtvQkFDaEIsS0FBSyxRQUFRLENBQUMsR0FBRzt3QkFDZixVQUFVLENBQUMsSUFBSSxDQUNiLGtCQUNFLGNBQWMsQ0FBQyxNQUFNLFFBQVEsQ0FBQyxZQUFZLENBQUMsQ0FDN0MsSUFBSSxDQUNMLENBQUM7d0JBQ0YsTUFBTTtvQkFDUixLQUFLLFFBQVEsQ0FBQyxPQUFPO3dCQUNuQixVQUFVLENBQUMsSUFBSSxDQUNiLDJCQUNFLGNBQWMsQ0FDWixNQUFNLFFBQVEsQ0FBQyxZQUFZLENBQUMsQ0FFaEMsS0FBSyxDQUNOLENBQUM7d0JBQ0YsTUFBTTtvQkFDUixLQUFLLFFBQVEsQ0FBQyxRQUFRO3dCQUNwQixVQUFVLENBQUMsSUFBSSxDQUFDLE1BQU0sUUFBUSxDQUFDLFlBQVksQ0FBQyxDQUFDLENBQUM7d0JBQzlDLE1BQU07aUJBQ1Q7YUFDRjtZQUNELFlBQVksQ0FBQyxLQUFLLEVBQUUsQ0FBQztZQUNyQixRQUFRLEdBQUcsUUFBUSxDQUFDLE1BQU0sQ0FBQztZQUMzQixTQUFTO1NBQ1Y7UUFDRCxNQUFNLGlCQUFpQixDQUFDLEdBQUcsQ0FBQyxLQUFLLEVBQVksQ0FBQyxDQUFDO0tBQ2hEO0lBR0QsT0FBTyxHQUFHLENBQUMsTUFBTSxHQUFHLENBQUMsRUFBRTtRQUNyQixNQUFNLGlCQUFpQixDQUFDLEdBQUcsQ0FBQyxLQUFLLEVBQVksQ0FBQyxDQUFDO0tBQ2hEO0lBQ0QsVUFBVSxDQUFDLElBQUksQ0FDYixtQkFBbUIsTUFBTSxvQkFBb0IsQ0FBQyxZQUFZLENBQUMsTUFBTSxDQUNsRSxDQUFDO0lBQ0YsWUFBWSxDQUFDLEtBQUssRUFBRSxDQUFDO0lBRXJCLE9BQU8sTUFBTSxXQUFXLENBQUMsVUFBVSxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDO0FBQ2hELENBQUM7QUFFRCxNQUFNLENBQUMsS0FBSyxVQUFVLGNBQWMsQ0FDbEMsSUFBWSxFQUNaLE1BQWM7SUFFZCxNQUFNLE1BQU0sR0FBRyxJQUFJLFlBQVksQ0FBQyxJQUFJLENBQUMsQ0FBQztJQUN0QyxNQUFNLFFBQVEsR0FBRyxNQUFNLE9BQU8sQ0FBQyxNQUFNLENBQUMsQ0FBQztJQUN2QyxPQUFPLFFBQVEsQ0FBQyxNQUFNLENBQUMsQ0FBQztBQUMxQixDQUFDO0FBRUQsTUFBTSxDQUFDLEtBQUssVUFBVSxrQkFBa0IsQ0FDdEMsSUFBWSxFQUNaLE1BQWM7SUFFZCxNQUFNLElBQUksR0FBRyxNQUFNLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQztJQUM5QixNQUFNLFFBQVEsR0FBRyxNQUFNLE9BQU8sQ0FBQyxJQUFJLENBQUMsQ0FBQztJQUNyQyxJQUFJLENBQUMsS0FBSyxFQUFFLENBQUM7SUFDYixPQUFPLFFBQVEsQ0FBQyxNQUFNLENBQUMsQ0FBQztBQUMxQixDQUFDO0FBRUQsTUFBTSxDQUFDLEtBQUssVUFBVSxNQUFNLENBQUMsSUFBWSxFQUFFLE1BQWM7SUFDdkQsTUFBTSxNQUFNLEdBQUcsTUFBTSxjQUFjLENBQUMsSUFBSSxFQUFFLE1BQU0sQ0FBQyxDQUFDO0lBQ2xELE9BQU8sSUFBSSxZQUFZLENBQUMsTUFBTSxDQUFDLENBQUM7QUFDbEMsQ0FBQztBQUVELE1BQU0sQ0FBQyxLQUFLLFVBQVUsVUFBVSxDQUM5QixJQUFZLEVBQ1osTUFBYztJQUVkLE1BQU0sTUFBTSxHQUFHLE1BQU0sa0JBQWtCLENBQUMsSUFBSSxFQUFFLE1BQU0sQ0FBQyxDQUFDO0lBQ3RELE9BQU8sSUFBSSxZQUFZLENBQUMsTUFBTSxDQUFDLENBQUM7QUFDbEMsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImNvbnN0IHsgb3BlbiB9ID0gRGVubztcbnR5cGUgUmVhZGVyID0gRGVuby5SZWFkZXI7XG5pbXBvcnQgeyBCdWZSZWFkZXIgfSBmcm9tIFwiLi92ZW5kb3IvaHR0cHMvZGVuby5sYW5kL3N0ZC9pby9idWZpby50c1wiO1xuaW1wb3J0IHsgQnVmZmVyIH0gZnJvbSBcIi4vdmVuZG9yL2h0dHBzL2Rlbm8ubGFuZC9zdGQvaW8vYnVmZmVyLnRzXCI7XG5pbXBvcnQgeyByZWFkQWxsIH0gZnJvbSBcIi4vdmVuZG9yL2h0dHBzL2Rlbm8ubGFuZC9zdGQvaW8vdXRpbC50c1wiO1xuaW1wb3J0IGVzY2FwZSBmcm9tIFwiLi92ZW5kb3IvaHR0cHMvZGVuby5sYW5kL3gvbG9kYXNoL2VzY2FwZS5qc1wiO1xuXG5leHBvcnQgaW50ZXJmYWNlIFBhcmFtcyB7XG4gIC8vZGVuby1saW50LWlnbm9yZSBuby1leHBsaWNpdC1hbnlcbiAgW2tleTogc3RyaW5nXTogYW55O1xufVxuXG5lbnVtIFJlYWRNb2RlIHtcbiAgTm9ybWFsLFxuICBFc2NhcGVkLFxuICBSYXcsXG4gIENvbW1lbnQsXG4gIEV2YWx1YXRlLFxufVxuXG5lbnVtIENvZGVzIHtcbiAgQmVnaW4gPSA2MCwgLy8gPFxuICBFbmQgPSA2MiwgLy8gPlxuICBQZXJjZW50ID0gMzcsIC8vICVcbiAgRXNjYXBlZCA9IDYxLCAvLyA9XG4gIFJhdyA9IDQ1LCAvLyAtXG4gIENvbW1lbnQgPSAzNSwgLy8gI1xufVxuXG5pbnRlcmZhY2UgVGVtcGxhdGUge1xuICAocGFyYW1zOiBQYXJhbXMpOiBQcm9taXNlPHN0cmluZz47XG59XG5cbmNvbnN0IGVuY29kZXIgPSBuZXcgVGV4dEVuY29kZXIoKTtcbmNvbnN0IGRlY29kZXIgPSBuZXcgVGV4dERlY29kZXIoXCJ1dGYtOFwiKTtcblxuY2xhc3MgU3RyaW5nUmVhZGVyIGV4dGVuZHMgQnVmZmVyIHtcbiAgY29uc3RydWN0b3Ioczogc3RyaW5nKSB7XG4gICAgc3VwZXIoZW5jb2Rlci5lbmNvZGUocykuYnVmZmVyKTtcbiAgfVxufVxuXG5hc3luYyBmdW5jdGlvbiBpbmNsdWRlKHBhdGg6IHN0cmluZywgcGFyYW1zOiBQYXJhbXMpOiBQcm9taXNlPHN0cmluZz4ge1xuICBjb25zdCByZXN1bHQgPSBhd2FpdCByZW5kZXJGaWxlKHBhdGgsIHBhcmFtcyk7XG4gIGNvbnN0IGJ1ZiA9IG5ldyBCdWZmZXIoKTtcbiAgYXdhaXQgYnVmLnJlYWRGcm9tKHJlc3VsdCk7XG4gIHJldHVybiBhd2FpdCBidWZUb1N0cihidWYpO1xufVxuXG5mdW5jdGlvbiBzYW5pdGl6ZShzdHI6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBzdHIucmVwbGFjZSgvXFxgL2csIFwiXFxcXGBcIikucmVwbGFjZSgvXFwkL2csIFwiXFxcXCRcIikucmVwbGFjZSgvXFxcXCskLywgXCJcIik7IC8vIFRyaW0gYmFja3NsYXNoZXMgYXQgbGluZSBlbmQuIFRPRE86IEZpeCB0aGlzIHRvIHJlbmRlciBiYWNrc2xhc2hlcy5cbn1cblxuYXN5bmMgZnVuY3Rpb24gYnVmVG9TdHIoYnVmOiBCdWZmZXIpOiBQcm9taXNlPHN0cmluZz4ge1xuICByZXR1cm4gZGVjb2Rlci5kZWNvZGUoYXdhaXQgcmVhZEFsbChidWYpKTtcbn1cblxuZnVuY3Rpb24gcmVtb3ZlTGFzdFNlbWkoczogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIHMudHJpbVJpZ2h0KCkucmVwbGFjZSgvOyQvLCBcIlwiKTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gYnVmVG9TdHJXaXRoU2FuaXRpemUoYnVmOiBCdWZmZXIpOiBQcm9taXNlPHN0cmluZz4ge1xuICByZXR1cm4gc2FuaXRpemUoYXdhaXQgYnVmVG9TdHIoYnVmKSk7XG59XG5cbmZ1bmN0aW9uIE5ld1RlbXBsYXRlKHNjcmlwdDogc3RyaW5nKTogVGVtcGxhdGUge1xuICByZXR1cm4gYXN5bmMgKHBhcmFtczogUGFyYW1zKTogUHJvbWlzZTxzdHJpbmc+ID0+IHtcbiAgICBjb25zdCBvdXRwdXQ6IEFycmF5PHN0cmluZz4gPSBbXTtcbiAgICBhd2FpdCBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICBjb25zdCBhcmdzID0ge1xuICAgICAgICBpbmNsdWRlLFxuICAgICAgICAuLi5wYXJhbXMsXG4gICAgICAgICQkT1VUUFVUOiBvdXRwdXQsXG4gICAgICAgICQkRklOSVNIRUQ6IHJlc29sdmUsXG4gICAgICAgICQkRVJST1I6IHJlamVjdCxcbiAgICAgICAgJCRFU0NBUEU6IGVzY2FwZSxcbiAgICAgIH07XG4gICAgICBjb25zdCBzcmMgPSBgKGFzeW5jKCkgPT4ge1xuICAgICAgICB0cnkgeyAke3NjcmlwdH0gfSBjYXRjaCAoZXJyb3IpIHsgJCRFUlJPUihlcnJvcikgfVxuICAgICAgICAkJEZJTklTSEVEKCk7XG4gICAgICB9KSgpO2A7XG4gICAgICBjb25zdCBmID0gbmV3IEZ1bmN0aW9uKC4uLk9iamVjdC5rZXlzKGFyZ3MpLCBzcmMpO1xuICAgICAgZiguLi5PYmplY3QudmFsdWVzKGFyZ3MpKTtcbiAgICB9KTtcbiAgICByZXR1cm4gb3V0cHV0LmpvaW4oXCJcIik7XG4gIH07XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBjb21waWxlKHJlYWRlcjogUmVhZGVyKTogUHJvbWlzZTxUZW1wbGF0ZT4ge1xuICBjb25zdCBzcmMgPSBuZXcgQnVmUmVhZGVyKHJlYWRlcik7XG4gIGNvbnN0IGJ1ZjogQXJyYXk8bnVtYmVyPiA9IFtdO1xuICBjb25zdCBzdGF0ZW1lbnRzOiBBcnJheTxzdHJpbmc+ID0gW107XG4gIGNvbnN0IHN0YXRlbWVudEJ1ZiA9IG5ldyBCdWZmZXIoKTtcbiAgbGV0IHJlYWRNb2RlOiBSZWFkTW9kZSA9IFJlYWRNb2RlLk5vcm1hbDtcbiAgY29uc3Qgc3RhdGVtZW50QnVmV3JpdGUgPSBhc3luYyAoYnl0ZTogbnVtYmVyKTogUHJvbWlzZTxudW1iZXI+ID0+XG4gICAgYXdhaXQgc3RhdGVtZW50QnVmLndyaXRlKG5ldyBVaW50OEFycmF5KFtieXRlXSkpO1xuXG4gIHdoaWxlICh0cnVlKSB7XG4gICAgY29uc3QgYnl0ZSA9IGF3YWl0IHNyYy5yZWFkQnl0ZSgpO1xuICAgIGlmIChieXRlID09PSBudWxsKSB7XG4gICAgICBicmVhaztcbiAgICB9XG5cbiAgICBidWYucHVzaChieXRlKTtcbiAgICBpZiAoYnVmLmxlbmd0aCA8IDMpIHtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGlmIChyZWFkTW9kZSA9PT0gUmVhZE1vZGUuTm9ybWFsKSB7XG4gICAgICAvLyBEZXRlY3QgUmVhZE1vZGVcbiAgICAgIGlmIChidWZbMF0gPT09IENvZGVzLkJlZ2luICYmIGJ1ZlsxXSA9PT0gQ29kZXMuUGVyY2VudCkge1xuICAgICAgICBzd2l0Y2ggKGJ1ZlsyXSkge1xuICAgICAgICAgIGNhc2UgQ29kZXMuRXNjYXBlZDpcbiAgICAgICAgICAgIHJlYWRNb2RlID0gUmVhZE1vZGUuRXNjYXBlZDtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgIGNhc2UgQ29kZXMuUmF3OlxuICAgICAgICAgICAgcmVhZE1vZGUgPSBSZWFkTW9kZS5SYXc7XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgICBjYXNlIENvZGVzLkNvbW1lbnQ6XG4gICAgICAgICAgICByZWFkTW9kZSA9IFJlYWRNb2RlLkNvbW1lbnQ7XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgICAgcmVhZE1vZGUgPSBSZWFkTW9kZS5FdmFsdWF0ZTtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9XG4gICAgICAgIHN0YXRlbWVudHMucHVzaChcbiAgICAgICAgICBgOyQkT1VUUFVULnB1c2goXFxgJHthd2FpdCBidWZUb1N0cldpdGhTYW5pdGl6ZShzdGF0ZW1lbnRCdWYpfVxcYCk7YCxcbiAgICAgICAgKTtcbiAgICAgICAgc3RhdGVtZW50QnVmLnJlc2V0KCk7XG4gICAgICAgIGJ1Zi5zcGxpY2UoMCk7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgaWYgKGJ1Zi5sZW5ndGggPiAyKSB7XG4gICAgICAgIGF3YWl0IHN0YXRlbWVudEJ1ZldyaXRlKGJ1Zi5zaGlmdCgpIGFzIG51bWJlcik7XG4gICAgICB9XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICAvLyBGaW5pc2ggY3VycmVudCBSZWFkTW9kZVxuICAgIGlmIChidWZbMV0gPT09IENvZGVzLlBlcmNlbnQgJiYgYnVmWzJdID09PSBDb2Rlcy5FbmQpIHtcbiAgICAgIHN0YXRlbWVudEJ1ZldyaXRlKGJ1Zi5zaGlmdCgpIGFzIG51bWJlcik7XG4gICAgICBidWYuc3BsaWNlKDApO1xuICAgICAgLy8gRG9uJ3QgZXhlY3V0ZSBpZiBSZWFkTW9kZSBpcyBDb21tZW50LlxuICAgICAgaWYgKHJlYWRNb2RlICE9PSBSZWFkTW9kZS5Db21tZW50KSB7XG4gICAgICAgIHN3aXRjaCAocmVhZE1vZGUpIHtcbiAgICAgICAgICBjYXNlIFJlYWRNb2RlLlJhdzpcbiAgICAgICAgICAgIHN0YXRlbWVudHMucHVzaChcbiAgICAgICAgICAgICAgYDskJE9VVFBVVC5wdXNoKCR7XG4gICAgICAgICAgICAgICAgcmVtb3ZlTGFzdFNlbWkoYXdhaXQgYnVmVG9TdHIoc3RhdGVtZW50QnVmKSlcbiAgICAgICAgICAgICAgfSk7YCxcbiAgICAgICAgICAgICk7XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgICBjYXNlIFJlYWRNb2RlLkVzY2FwZWQ6XG4gICAgICAgICAgICBzdGF0ZW1lbnRzLnB1c2goXG4gICAgICAgICAgICAgIGA7JCRPVVRQVVQucHVzaCgkJEVTQ0FQRSgke1xuICAgICAgICAgICAgICAgIHJlbW92ZUxhc3RTZW1pKFxuICAgICAgICAgICAgICAgICAgYXdhaXQgYnVmVG9TdHIoc3RhdGVtZW50QnVmKSxcbiAgICAgICAgICAgICAgICApXG4gICAgICAgICAgICAgIH0pKTtgLFxuICAgICAgICAgICAgKTtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgIGNhc2UgUmVhZE1vZGUuRXZhbHVhdGU6XG4gICAgICAgICAgICBzdGF0ZW1lbnRzLnB1c2goYXdhaXQgYnVmVG9TdHIoc3RhdGVtZW50QnVmKSk7XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgc3RhdGVtZW50QnVmLnJlc2V0KCk7XG4gICAgICByZWFkTW9kZSA9IFJlYWRNb2RlLk5vcm1hbDtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBhd2FpdCBzdGF0ZW1lbnRCdWZXcml0ZShidWYuc2hpZnQoKSBhcyBudW1iZXIpO1xuICB9XG5cbiAgLy8gRmx1c2ggYnVmZmVyXG4gIHdoaWxlIChidWYubGVuZ3RoID4gMCkge1xuICAgIGF3YWl0IHN0YXRlbWVudEJ1ZldyaXRlKGJ1Zi5zaGlmdCgpIGFzIG51bWJlcik7XG4gIH1cbiAgc3RhdGVtZW50cy5wdXNoKFxuICAgIGAkJE9VVFBVVC5wdXNoKFxcYCR7YXdhaXQgYnVmVG9TdHJXaXRoU2FuaXRpemUoc3RhdGVtZW50QnVmKX1cXGApO2AsXG4gICk7XG4gIHN0YXRlbWVudEJ1Zi5yZXNldCgpO1xuXG4gIHJldHVybiBhd2FpdCBOZXdUZW1wbGF0ZShzdGF0ZW1lbnRzLmpvaW4oXCJcIikpO1xufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcmVuZGVyVG9TdHJpbmcoXG4gIGJvZHk6IHN0cmluZyxcbiAgcGFyYW1zOiBQYXJhbXMsXG4pOiBQcm9taXNlPHN0cmluZz4ge1xuICBjb25zdCByZWFkZXIgPSBuZXcgU3RyaW5nUmVhZGVyKGJvZHkpO1xuICBjb25zdCB0ZW1wbGF0ZSA9IGF3YWl0IGNvbXBpbGUocmVhZGVyKTtcbiAgcmV0dXJuIHRlbXBsYXRlKHBhcmFtcyk7XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiByZW5kZXJGaWxlVG9TdHJpbmcoXG4gIHBhdGg6IHN0cmluZyxcbiAgcGFyYW1zOiBQYXJhbXMsXG4pOiBQcm9taXNlPHN0cmluZz4ge1xuICBjb25zdCBmaWxlID0gYXdhaXQgb3BlbihwYXRoKTtcbiAgY29uc3QgdGVtcGxhdGUgPSBhd2FpdCBjb21waWxlKGZpbGUpO1xuICBmaWxlLmNsb3NlKCk7XG4gIHJldHVybiB0ZW1wbGF0ZShwYXJhbXMpO1xufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcmVuZGVyKGJvZHk6IHN0cmluZywgcGFyYW1zOiBQYXJhbXMpOiBQcm9taXNlPFJlYWRlcj4ge1xuICBjb25zdCByZXN1bHQgPSBhd2FpdCByZW5kZXJUb1N0cmluZyhib2R5LCBwYXJhbXMpO1xuICByZXR1cm4gbmV3IFN0cmluZ1JlYWRlcihyZXN1bHQpO1xufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcmVuZGVyRmlsZShcbiAgcGF0aDogc3RyaW5nLFxuICBwYXJhbXM6IFBhcmFtcyxcbik6IFByb21pc2U8UmVhZGVyPiB7XG4gIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHJlbmRlckZpbGVUb1N0cmluZyhwYXRoLCBwYXJhbXMpO1xuICByZXR1cm4gbmV3IFN0cmluZ1JlYWRlcihyZXN1bHQpO1xufVxuIl19