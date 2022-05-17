// Copyright 2018-2021 the Deno authors. All rights reserved. MIT license.
import { Tokenizer } from "./tokenizer.ts";
function digits(value, count = 2) {
    return String(value).padStart(count, "0");
}
function createLiteralTestFunction(value) {
    return (string)=>{
        return string.startsWith(value) ? {
            value,
            length: value.length
        } : undefined;
    };
}
function createMatchTestFunction(match) {
    return (string)=>{
        const result = match.exec(string);
        if (result) return {
            value: result,
            length: result[0].length
        };
    };
}
// according to unicode symbols (http://www.unicode.org/reports/tr35/tr35-dates.html#Date_Field_Symbol_Table)
const defaultRules = [
    {
        test: createLiteralTestFunction("yyyy"),
        fn: ()=>({
                type: "year",
                value: "numeric"
            })
    },
    {
        test: createLiteralTestFunction("yy"),
        fn: ()=>({
                type: "year",
                value: "2-digit"
            })
    },
    {
        test: createLiteralTestFunction("MM"),
        fn: ()=>({
                type: "month",
                value: "2-digit"
            })
    },
    {
        test: createLiteralTestFunction("M"),
        fn: ()=>({
                type: "month",
                value: "numeric"
            })
    },
    {
        test: createLiteralTestFunction("dd"),
        fn: ()=>({
                type: "day",
                value: "2-digit"
            })
    },
    {
        test: createLiteralTestFunction("d"),
        fn: ()=>({
                type: "day",
                value: "numeric"
            })
    },
    {
        test: createLiteralTestFunction("HH"),
        fn: ()=>({
                type: "hour",
                value: "2-digit"
            })
    },
    {
        test: createLiteralTestFunction("H"),
        fn: ()=>({
                type: "hour",
                value: "numeric"
            })
    },
    {
        test: createLiteralTestFunction("hh"),
        fn: ()=>({
                type: "hour",
                value: "2-digit",
                hour12: true
            })
    },
    {
        test: createLiteralTestFunction("h"),
        fn: ()=>({
                type: "hour",
                value: "numeric",
                hour12: true
            })
    },
    {
        test: createLiteralTestFunction("mm"),
        fn: ()=>({
                type: "minute",
                value: "2-digit"
            })
    },
    {
        test: createLiteralTestFunction("m"),
        fn: ()=>({
                type: "minute",
                value: "numeric"
            })
    },
    {
        test: createLiteralTestFunction("ss"),
        fn: ()=>({
                type: "second",
                value: "2-digit"
            })
    },
    {
        test: createLiteralTestFunction("s"),
        fn: ()=>({
                type: "second",
                value: "numeric"
            })
    },
    {
        test: createLiteralTestFunction("SSS"),
        fn: ()=>({
                type: "fractionalSecond",
                value: 3
            })
    },
    {
        test: createLiteralTestFunction("SS"),
        fn: ()=>({
                type: "fractionalSecond",
                value: 2
            })
    },
    {
        test: createLiteralTestFunction("S"),
        fn: ()=>({
                type: "fractionalSecond",
                value: 1
            })
    },
    {
        test: createLiteralTestFunction("a"),
        fn: (value)=>({
                type: "dayPeriod",
                value: value
            })
    },
    // quoted literal
    {
        test: createMatchTestFunction(/^(')(?<value>\\.|[^\']*)\1/),
        fn: (match)=>({
                type: "literal",
                value: match.groups.value
            })
    },
    // literal
    {
        test: createMatchTestFunction(/^.+?\s*/),
        fn: (match)=>({
                type: "literal",
                value: match[0]
            })
    }, 
];
export class DateTimeFormatter {
    #format;
    constructor(formatString, rules = defaultRules){
        const tokenizer = new Tokenizer(rules);
        this.#format = tokenizer.tokenize(formatString, ({ type , value , hour12  })=>{
            const result = {
                type,
                value
            };
            if (hour12) result.hour12 = hour12;
            return result;
        });
    }
    format(date, options = {
    }) {
        let string = "";
        const utc = options.timeZone === "UTC";
        for (const token of this.#format){
            const type = token.type;
            switch(type){
                case "year":
                    {
                        const value = utc ? date.getUTCFullYear() : date.getFullYear();
                        switch(token.value){
                            case "numeric":
                                {
                                    string += value;
                                    break;
                                }
                            case "2-digit":
                                {
                                    string += digits(value, 2).slice(-2);
                                    break;
                                }
                            default:
                                throw Error(`FormatterError: value "${token.value}" is not supported`);
                        }
                        break;
                    }
                case "month":
                    {
                        const value = (utc ? date.getUTCMonth() : date.getMonth()) + 1;
                        switch(token.value){
                            case "numeric":
                                {
                                    string += value;
                                    break;
                                }
                            case "2-digit":
                                {
                                    string += digits(value, 2);
                                    break;
                                }
                            default:
                                throw Error(`FormatterError: value "${token.value}" is not supported`);
                        }
                        break;
                    }
                case "day":
                    {
                        const value = utc ? date.getUTCDate() : date.getDate();
                        switch(token.value){
                            case "numeric":
                                {
                                    string += value;
                                    break;
                                }
                            case "2-digit":
                                {
                                    string += digits(value, 2);
                                    break;
                                }
                            default:
                                throw Error(`FormatterError: value "${token.value}" is not supported`);
                        }
                        break;
                    }
                case "hour":
                    {
                        let value = utc ? date.getUTCHours() : date.getHours();
                        value -= token.hour12 && date.getHours() > 12 ? 12 : 0;
                        switch(token.value){
                            case "numeric":
                                {
                                    string += value;
                                    break;
                                }
                            case "2-digit":
                                {
                                    string += digits(value, 2);
                                    break;
                                }
                            default:
                                throw Error(`FormatterError: value "${token.value}" is not supported`);
                        }
                        break;
                    }
                case "minute":
                    {
                        const value = utc ? date.getUTCMinutes() : date.getMinutes();
                        switch(token.value){
                            case "numeric":
                                {
                                    string += value;
                                    break;
                                }
                            case "2-digit":
                                {
                                    string += digits(value, 2);
                                    break;
                                }
                            default:
                                throw Error(`FormatterError: value "${token.value}" is not supported`);
                        }
                        break;
                    }
                case "second":
                    {
                        const value = utc ? date.getUTCSeconds() : date.getSeconds();
                        switch(token.value){
                            case "numeric":
                                {
                                    string += value;
                                    break;
                                }
                            case "2-digit":
                                {
                                    string += digits(value, 2);
                                    break;
                                }
                            default:
                                throw Error(`FormatterError: value "${token.value}" is not supported`);
                        }
                        break;
                    }
                case "fractionalSecond":
                    {
                        const value = utc ? date.getUTCMilliseconds() : date.getMilliseconds();
                        string += digits(value, Number(token.value));
                        break;
                    }
                // FIXME(bartlomieju)
                case "timeZoneName":
                    {
                        break;
                    }
                case "dayPeriod":
                    {
                        string += token.value ? date.getHours() >= 12 ? "PM" : "AM" : "";
                        break;
                    }
                case "literal":
                    {
                        string += token.value;
                        break;
                    }
                default:
                    throw Error(`FormatterError: { ${token.type} ${token.value} }`);
            }
        }
        return string;
    }
    parseToParts(string) {
        const parts = [];
        for (const token of this.#format){
            const type = token.type;
            let value = "";
            switch(token.type){
                case "year":
                    {
                        switch(token.value){
                            case "numeric":
                                {
                                    value = /^\d{1,4}/.exec(string)?.[0];
                                    break;
                                }
                            case "2-digit":
                                {
                                    value = /^\d{1,2}/.exec(string)?.[0];
                                    break;
                                }
                        }
                        break;
                    }
                case "month":
                    {
                        switch(token.value){
                            case "numeric":
                                {
                                    value = /^\d{1,2}/.exec(string)?.[0];
                                    break;
                                }
                            case "2-digit":
                                {
                                    value = /^\d{2}/.exec(string)?.[0];
                                    break;
                                }
                            case "narrow":
                                {
                                    value = /^[a-zA-Z]+/.exec(string)?.[0];
                                    break;
                                }
                            case "short":
                                {
                                    value = /^[a-zA-Z]+/.exec(string)?.[0];
                                    break;
                                }
                            case "long":
                                {
                                    value = /^[a-zA-Z]+/.exec(string)?.[0];
                                    break;
                                }
                            default:
                                throw Error(`ParserError: value "${token.value}" is not supported`);
                        }
                        break;
                    }
                case "day":
                    {
                        switch(token.value){
                            case "numeric":
                                {
                                    value = /^\d{1,2}/.exec(string)?.[0];
                                    break;
                                }
                            case "2-digit":
                                {
                                    value = /^\d{2}/.exec(string)?.[0];
                                    break;
                                }
                            default:
                                throw Error(`ParserError: value "${token.value}" is not supported`);
                        }
                        break;
                    }
                case "hour":
                    {
                        switch(token.value){
                            case "numeric":
                                {
                                    value = /^\d{1,2}/.exec(string)?.[0];
                                    if (token.hour12 && parseInt(value) > 12) {
                                        console.error(`Trying to parse hour greater than 12. Use 'H' instead of 'h'.`);
                                    }
                                    break;
                                }
                            case "2-digit":
                                {
                                    value = /^\d{2}/.exec(string)?.[0];
                                    if (token.hour12 && parseInt(value) > 12) {
                                        console.error(`Trying to parse hour greater than 12. Use 'HH' instead of 'hh'.`);
                                    }
                                    break;
                                }
                            default:
                                throw Error(`ParserError: value "${token.value}" is not supported`);
                        }
                        break;
                    }
                case "minute":
                    {
                        switch(token.value){
                            case "numeric":
                                {
                                    value = /^\d{1,2}/.exec(string)?.[0];
                                    break;
                                }
                            case "2-digit":
                                {
                                    value = /^\d{2}/.exec(string)?.[0];
                                    break;
                                }
                            default:
                                throw Error(`ParserError: value "${token.value}" is not supported`);
                        }
                        break;
                    }
                case "second":
                    {
                        switch(token.value){
                            case "numeric":
                                {
                                    value = /^\d{1,2}/.exec(string)?.[0];
                                    break;
                                }
                            case "2-digit":
                                {
                                    value = /^\d{2}/.exec(string)?.[0];
                                    break;
                                }
                            default:
                                throw Error(`ParserError: value "${token.value}" is not supported`);
                        }
                        break;
                    }
                case "fractionalSecond":
                    {
                        value = new RegExp(`^\\d{${token.value}}`).exec(string)?.[0];
                        break;
                    }
                case "timeZoneName":
                    {
                        value = token.value;
                        break;
                    }
                case "dayPeriod":
                    {
                        value = /^(A|P)M/.exec(string)?.[0];
                        break;
                    }
                case "literal":
                    {
                        if (!string.startsWith(token.value)) {
                            throw Error(`Literal "${token.value}" not found "${string.slice(0, 25)}"`);
                        }
                        value = token.value;
                        break;
                    }
                default:
                    throw Error(`${token.type} ${token.value}`);
            }
            if (!value) {
                throw Error(`value not valid for token { ${type} ${value} } ${string.slice(0, 25)}`);
            }
            parts.push({
                type,
                value
            });
            string = string.slice(value.length);
        }
        if (string.length) {
            throw Error(`datetime string was not fully parsed! ${string.slice(0, 25)}`);
        }
        return parts;
    }
    /** sort & filter dateTimeFormatPart */ sortDateTimeFormatPart(parts) {
        let result = [];
        const typeArray = [
            "year",
            "month",
            "day",
            "hour",
            "minute",
            "second",
            "fractionalSecond", 
        ];
        for (const type of typeArray){
            const current = parts.findIndex((el)=>el.type === type
            );
            if (current !== -1) {
                result = result.concat(parts.splice(current, 1));
            }
        }
        result = result.concat(parts);
        return result;
    }
    partsToDate(parts) {
        const date = new Date();
        const utc = parts.find((part)=>part.type === "timeZoneName" && part.value === "UTC"
        );
        utc ? date.setUTCHours(0, 0, 0, 0) : date.setHours(0, 0, 0, 0);
        for (const part of parts){
            switch(part.type){
                case "year":
                    {
                        const value = Number(part.value.padStart(4, "20"));
                        utc ? date.setUTCFullYear(value) : date.setFullYear(value);
                        break;
                    }
                case "month":
                    {
                        const value = Number(part.value) - 1;
                        utc ? date.setUTCMonth(value) : date.setMonth(value);
                        break;
                    }
                case "day":
                    {
                        const value = Number(part.value);
                        utc ? date.setUTCDate(value) : date.setDate(value);
                        break;
                    }
                case "hour":
                    {
                        let value = Number(part.value);
                        const dayPeriod = parts.find((part)=>part.type === "dayPeriod"
                        );
                        if (dayPeriod?.value === "PM") value += 12;
                        utc ? date.setUTCHours(value) : date.setHours(value);
                        break;
                    }
                case "minute":
                    {
                        const value = Number(part.value);
                        utc ? date.setUTCMinutes(value) : date.setMinutes(value);
                        break;
                    }
                case "second":
                    {
                        const value = Number(part.value);
                        utc ? date.setUTCSeconds(value) : date.setSeconds(value);
                        break;
                    }
                case "fractionalSecond":
                    {
                        const value = Number(part.value);
                        utc ? date.setUTCMilliseconds(value) : date.setMilliseconds(value);
                        break;
                    }
            }
        }
        return date;
    }
    parse(string) {
        const parts = this.parseToParts(string);
        const sortParts = this.sortDateTimeFormatPart(parts);
        return this.partsToDate(sortParts);
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbImh0dHBzOi8vZGVuby5sYW5kL3N0ZEAwLjk5LjAvZGF0ZXRpbWUvZm9ybWF0dGVyLnRzIl0sInNvdXJjZXNDb250ZW50IjpbIi8vIENvcHlyaWdodCAyMDE4LTIwMjEgdGhlIERlbm8gYXV0aG9ycy4gQWxsIHJpZ2h0cyByZXNlcnZlZC4gTUlUIGxpY2Vuc2UuXG5pbXBvcnQge1xuICBDYWxsYmFja1Jlc3VsdCxcbiAgUmVjZWl2ZXJSZXN1bHQsXG4gIFJ1bGUsXG4gIFRlc3RGdW5jdGlvbixcbiAgVGVzdFJlc3VsdCxcbiAgVG9rZW5pemVyLFxufSBmcm9tIFwiLi90b2tlbml6ZXIudHNcIjtcblxuZnVuY3Rpb24gZGlnaXRzKHZhbHVlOiBzdHJpbmcgfCBudW1iZXIsIGNvdW50ID0gMik6IHN0cmluZyB7XG4gIHJldHVybiBTdHJpbmcodmFsdWUpLnBhZFN0YXJ0KGNvdW50LCBcIjBcIik7XG59XG5cbi8vIGFzIGRlY2xhcmVkIGFzIGluIG5hbWVzcGFjZSBJbnRsXG50eXBlIERhdGVUaW1lRm9ybWF0UGFydFR5cGVzID1cbiAgfCBcImRheVwiXG4gIHwgXCJkYXlQZXJpb2RcIlxuICAvLyB8IFwiZXJhXCJcbiAgfCBcImhvdXJcIlxuICB8IFwibGl0ZXJhbFwiXG4gIHwgXCJtaW51dGVcIlxuICB8IFwibW9udGhcIlxuICB8IFwic2Vjb25kXCJcbiAgfCBcInRpbWVab25lTmFtZVwiXG4gIC8vIHwgXCJ3ZWVrZGF5XCJcbiAgfCBcInllYXJcIlxuICB8IFwiZnJhY3Rpb25hbFNlY29uZFwiO1xuXG5pbnRlcmZhY2UgRGF0ZVRpbWVGb3JtYXRQYXJ0IHtcbiAgdHlwZTogRGF0ZVRpbWVGb3JtYXRQYXJ0VHlwZXM7XG4gIHZhbHVlOiBzdHJpbmc7XG59XG5cbnR5cGUgVGltZVpvbmUgPSBcIlVUQ1wiO1xuXG5pbnRlcmZhY2UgT3B0aW9ucyB7XG4gIHRpbWVab25lPzogVGltZVpvbmU7XG59XG5cbmZ1bmN0aW9uIGNyZWF0ZUxpdGVyYWxUZXN0RnVuY3Rpb24odmFsdWU6IHN0cmluZyk6IFRlc3RGdW5jdGlvbiB7XG4gIHJldHVybiAoc3RyaW5nOiBzdHJpbmcpOiBUZXN0UmVzdWx0ID0+IHtcbiAgICByZXR1cm4gc3RyaW5nLnN0YXJ0c1dpdGgodmFsdWUpXG4gICAgICA/IHsgdmFsdWUsIGxlbmd0aDogdmFsdWUubGVuZ3RoIH1cbiAgICAgIDogdW5kZWZpbmVkO1xuICB9O1xufVxuXG5mdW5jdGlvbiBjcmVhdGVNYXRjaFRlc3RGdW5jdGlvbihtYXRjaDogUmVnRXhwKTogVGVzdEZ1bmN0aW9uIHtcbiAgcmV0dXJuIChzdHJpbmc6IHN0cmluZyk6IFRlc3RSZXN1bHQgPT4ge1xuICAgIGNvbnN0IHJlc3VsdCA9IG1hdGNoLmV4ZWMoc3RyaW5nKTtcbiAgICBpZiAocmVzdWx0KSByZXR1cm4geyB2YWx1ZTogcmVzdWx0LCBsZW5ndGg6IHJlc3VsdFswXS5sZW5ndGggfTtcbiAgfTtcbn1cblxuLy8gYWNjb3JkaW5nIHRvIHVuaWNvZGUgc3ltYm9scyAoaHR0cDovL3d3dy51bmljb2RlLm9yZy9yZXBvcnRzL3RyMzUvdHIzNS1kYXRlcy5odG1sI0RhdGVfRmllbGRfU3ltYm9sX1RhYmxlKVxuY29uc3QgZGVmYXVsdFJ1bGVzID0gW1xuICB7XG4gICAgdGVzdDogY3JlYXRlTGl0ZXJhbFRlc3RGdW5jdGlvbihcInl5eXlcIiksXG4gICAgZm46ICgpOiBDYWxsYmFja1Jlc3VsdCA9PiAoeyB0eXBlOiBcInllYXJcIiwgdmFsdWU6IFwibnVtZXJpY1wiIH0pLFxuICB9LFxuICB7XG4gICAgdGVzdDogY3JlYXRlTGl0ZXJhbFRlc3RGdW5jdGlvbihcInl5XCIpLFxuICAgIGZuOiAoKTogQ2FsbGJhY2tSZXN1bHQgPT4gKHsgdHlwZTogXCJ5ZWFyXCIsIHZhbHVlOiBcIjItZGlnaXRcIiB9KSxcbiAgfSxcblxuICB7XG4gICAgdGVzdDogY3JlYXRlTGl0ZXJhbFRlc3RGdW5jdGlvbihcIk1NXCIpLFxuICAgIGZuOiAoKTogQ2FsbGJhY2tSZXN1bHQgPT4gKHsgdHlwZTogXCJtb250aFwiLCB2YWx1ZTogXCIyLWRpZ2l0XCIgfSksXG4gIH0sXG4gIHtcbiAgICB0ZXN0OiBjcmVhdGVMaXRlcmFsVGVzdEZ1bmN0aW9uKFwiTVwiKSxcbiAgICBmbjogKCk6IENhbGxiYWNrUmVzdWx0ID0+ICh7IHR5cGU6IFwibW9udGhcIiwgdmFsdWU6IFwibnVtZXJpY1wiIH0pLFxuICB9LFxuICB7XG4gICAgdGVzdDogY3JlYXRlTGl0ZXJhbFRlc3RGdW5jdGlvbihcImRkXCIpLFxuICAgIGZuOiAoKTogQ2FsbGJhY2tSZXN1bHQgPT4gKHsgdHlwZTogXCJkYXlcIiwgdmFsdWU6IFwiMi1kaWdpdFwiIH0pLFxuICB9LFxuICB7XG4gICAgdGVzdDogY3JlYXRlTGl0ZXJhbFRlc3RGdW5jdGlvbihcImRcIiksXG4gICAgZm46ICgpOiBDYWxsYmFja1Jlc3VsdCA9PiAoeyB0eXBlOiBcImRheVwiLCB2YWx1ZTogXCJudW1lcmljXCIgfSksXG4gIH0sXG5cbiAge1xuICAgIHRlc3Q6IGNyZWF0ZUxpdGVyYWxUZXN0RnVuY3Rpb24oXCJISFwiKSxcbiAgICBmbjogKCk6IENhbGxiYWNrUmVzdWx0ID0+ICh7IHR5cGU6IFwiaG91clwiLCB2YWx1ZTogXCIyLWRpZ2l0XCIgfSksXG4gIH0sXG4gIHtcbiAgICB0ZXN0OiBjcmVhdGVMaXRlcmFsVGVzdEZ1bmN0aW9uKFwiSFwiKSxcbiAgICBmbjogKCk6IENhbGxiYWNrUmVzdWx0ID0+ICh7IHR5cGU6IFwiaG91clwiLCB2YWx1ZTogXCJudW1lcmljXCIgfSksXG4gIH0sXG4gIHtcbiAgICB0ZXN0OiBjcmVhdGVMaXRlcmFsVGVzdEZ1bmN0aW9uKFwiaGhcIiksXG4gICAgZm46ICgpOiBDYWxsYmFja1Jlc3VsdCA9PiAoe1xuICAgICAgdHlwZTogXCJob3VyXCIsXG4gICAgICB2YWx1ZTogXCIyLWRpZ2l0XCIsXG4gICAgICBob3VyMTI6IHRydWUsXG4gICAgfSksXG4gIH0sXG4gIHtcbiAgICB0ZXN0OiBjcmVhdGVMaXRlcmFsVGVzdEZ1bmN0aW9uKFwiaFwiKSxcbiAgICBmbjogKCk6IENhbGxiYWNrUmVzdWx0ID0+ICh7XG4gICAgICB0eXBlOiBcImhvdXJcIixcbiAgICAgIHZhbHVlOiBcIm51bWVyaWNcIixcbiAgICAgIGhvdXIxMjogdHJ1ZSxcbiAgICB9KSxcbiAgfSxcbiAge1xuICAgIHRlc3Q6IGNyZWF0ZUxpdGVyYWxUZXN0RnVuY3Rpb24oXCJtbVwiKSxcbiAgICBmbjogKCk6IENhbGxiYWNrUmVzdWx0ID0+ICh7IHR5cGU6IFwibWludXRlXCIsIHZhbHVlOiBcIjItZGlnaXRcIiB9KSxcbiAgfSxcbiAge1xuICAgIHRlc3Q6IGNyZWF0ZUxpdGVyYWxUZXN0RnVuY3Rpb24oXCJtXCIpLFxuICAgIGZuOiAoKTogQ2FsbGJhY2tSZXN1bHQgPT4gKHsgdHlwZTogXCJtaW51dGVcIiwgdmFsdWU6IFwibnVtZXJpY1wiIH0pLFxuICB9LFxuICB7XG4gICAgdGVzdDogY3JlYXRlTGl0ZXJhbFRlc3RGdW5jdGlvbihcInNzXCIpLFxuICAgIGZuOiAoKTogQ2FsbGJhY2tSZXN1bHQgPT4gKHsgdHlwZTogXCJzZWNvbmRcIiwgdmFsdWU6IFwiMi1kaWdpdFwiIH0pLFxuICB9LFxuICB7XG4gICAgdGVzdDogY3JlYXRlTGl0ZXJhbFRlc3RGdW5jdGlvbihcInNcIiksXG4gICAgZm46ICgpOiBDYWxsYmFja1Jlc3VsdCA9PiAoeyB0eXBlOiBcInNlY29uZFwiLCB2YWx1ZTogXCJudW1lcmljXCIgfSksXG4gIH0sXG4gIHtcbiAgICB0ZXN0OiBjcmVhdGVMaXRlcmFsVGVzdEZ1bmN0aW9uKFwiU1NTXCIpLFxuICAgIGZuOiAoKTogQ2FsbGJhY2tSZXN1bHQgPT4gKHsgdHlwZTogXCJmcmFjdGlvbmFsU2Vjb25kXCIsIHZhbHVlOiAzIH0pLFxuICB9LFxuICB7XG4gICAgdGVzdDogY3JlYXRlTGl0ZXJhbFRlc3RGdW5jdGlvbihcIlNTXCIpLFxuICAgIGZuOiAoKTogQ2FsbGJhY2tSZXN1bHQgPT4gKHsgdHlwZTogXCJmcmFjdGlvbmFsU2Vjb25kXCIsIHZhbHVlOiAyIH0pLFxuICB9LFxuICB7XG4gICAgdGVzdDogY3JlYXRlTGl0ZXJhbFRlc3RGdW5jdGlvbihcIlNcIiksXG4gICAgZm46ICgpOiBDYWxsYmFja1Jlc3VsdCA9PiAoeyB0eXBlOiBcImZyYWN0aW9uYWxTZWNvbmRcIiwgdmFsdWU6IDEgfSksXG4gIH0sXG5cbiAge1xuICAgIHRlc3Q6IGNyZWF0ZUxpdGVyYWxUZXN0RnVuY3Rpb24oXCJhXCIpLFxuICAgIGZuOiAodmFsdWU6IHVua25vd24pOiBDYWxsYmFja1Jlc3VsdCA9PiAoe1xuICAgICAgdHlwZTogXCJkYXlQZXJpb2RcIixcbiAgICAgIHZhbHVlOiB2YWx1ZSBhcyBzdHJpbmcsXG4gICAgfSksXG4gIH0sXG5cbiAgLy8gcXVvdGVkIGxpdGVyYWxcbiAge1xuICAgIHRlc3Q6IGNyZWF0ZU1hdGNoVGVzdEZ1bmN0aW9uKC9eKCcpKD88dmFsdWU+XFxcXC58W15cXCddKilcXDEvKSxcbiAgICBmbjogKG1hdGNoOiB1bmtub3duKTogQ2FsbGJhY2tSZXN1bHQgPT4gKHtcbiAgICAgIHR5cGU6IFwibGl0ZXJhbFwiLFxuICAgICAgdmFsdWU6IChtYXRjaCBhcyBSZWdFeHBFeGVjQXJyYXkpLmdyb3VwcyEudmFsdWUgYXMgc3RyaW5nLFxuICAgIH0pLFxuICB9LFxuICAvLyBsaXRlcmFsXG4gIHtcbiAgICB0ZXN0OiBjcmVhdGVNYXRjaFRlc3RGdW5jdGlvbigvXi4rP1xccyovKSxcbiAgICBmbjogKG1hdGNoOiB1bmtub3duKTogQ2FsbGJhY2tSZXN1bHQgPT4gKHtcbiAgICAgIHR5cGU6IFwibGl0ZXJhbFwiLFxuICAgICAgdmFsdWU6IChtYXRjaCBhcyBSZWdFeHBFeGVjQXJyYXkpWzBdLFxuICAgIH0pLFxuICB9LFxuXTtcblxudHlwZSBGb3JtYXRQYXJ0ID0ge1xuICB0eXBlOiBEYXRlVGltZUZvcm1hdFBhcnRUeXBlcztcbiAgdmFsdWU6IHN0cmluZyB8IG51bWJlcjtcbiAgaG91cjEyPzogYm9vbGVhbjtcbn07XG50eXBlIEZvcm1hdCA9IEZvcm1hdFBhcnRbXTtcblxuZXhwb3J0IGNsYXNzIERhdGVUaW1lRm9ybWF0dGVyIHtcbiAgI2Zvcm1hdDogRm9ybWF0O1xuXG4gIGNvbnN0cnVjdG9yKGZvcm1hdFN0cmluZzogc3RyaW5nLCBydWxlczogUnVsZVtdID0gZGVmYXVsdFJ1bGVzKSB7XG4gICAgY29uc3QgdG9rZW5pemVyID0gbmV3IFRva2VuaXplcihydWxlcyk7XG4gICAgdGhpcy4jZm9ybWF0ID0gdG9rZW5pemVyLnRva2VuaXplKFxuICAgICAgZm9ybWF0U3RyaW5nLFxuICAgICAgKHsgdHlwZSwgdmFsdWUsIGhvdXIxMiB9KSA9PiB7XG4gICAgICAgIGNvbnN0IHJlc3VsdCA9IHtcbiAgICAgICAgICB0eXBlLFxuICAgICAgICAgIHZhbHVlLFxuICAgICAgICB9IGFzIHVua25vd24gYXMgUmVjZWl2ZXJSZXN1bHQ7XG4gICAgICAgIGlmIChob3VyMTIpIHJlc3VsdC5ob3VyMTIgPSBob3VyMTIgYXMgYm9vbGVhbjtcbiAgICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICAgIH0sXG4gICAgKSBhcyBGb3JtYXQ7XG4gIH1cblxuICBmb3JtYXQoZGF0ZTogRGF0ZSwgb3B0aW9uczogT3B0aW9ucyA9IHt9KTogc3RyaW5nIHtcbiAgICBsZXQgc3RyaW5nID0gXCJcIjtcblxuICAgIGNvbnN0IHV0YyA9IG9wdGlvbnMudGltZVpvbmUgPT09IFwiVVRDXCI7XG5cbiAgICBmb3IgKGNvbnN0IHRva2VuIG9mIHRoaXMuI2Zvcm1hdCkge1xuICAgICAgY29uc3QgdHlwZSA9IHRva2VuLnR5cGU7XG5cbiAgICAgIHN3aXRjaCAodHlwZSkge1xuICAgICAgICBjYXNlIFwieWVhclwiOiB7XG4gICAgICAgICAgY29uc3QgdmFsdWUgPSB1dGMgPyBkYXRlLmdldFVUQ0Z1bGxZZWFyKCkgOiBkYXRlLmdldEZ1bGxZZWFyKCk7XG4gICAgICAgICAgc3dpdGNoICh0b2tlbi52YWx1ZSkge1xuICAgICAgICAgICAgY2FzZSBcIm51bWVyaWNcIjoge1xuICAgICAgICAgICAgICBzdHJpbmcgKz0gdmFsdWU7XG4gICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgY2FzZSBcIjItZGlnaXRcIjoge1xuICAgICAgICAgICAgICBzdHJpbmcgKz0gZGlnaXRzKHZhbHVlLCAyKS5zbGljZSgtMik7XG4gICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICAgICAgdGhyb3cgRXJyb3IoXG4gICAgICAgICAgICAgICAgYEZvcm1hdHRlckVycm9yOiB2YWx1ZSBcIiR7dG9rZW4udmFsdWV9XCIgaXMgbm90IHN1cHBvcnRlZGAsXG4gICAgICAgICAgICAgICk7XG4gICAgICAgICAgfVxuICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9XG4gICAgICAgIGNhc2UgXCJtb250aFwiOiB7XG4gICAgICAgICAgY29uc3QgdmFsdWUgPSAodXRjID8gZGF0ZS5nZXRVVENNb250aCgpIDogZGF0ZS5nZXRNb250aCgpKSArIDE7XG4gICAgICAgICAgc3dpdGNoICh0b2tlbi52YWx1ZSkge1xuICAgICAgICAgICAgY2FzZSBcIm51bWVyaWNcIjoge1xuICAgICAgICAgICAgICBzdHJpbmcgKz0gdmFsdWU7XG4gICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgY2FzZSBcIjItZGlnaXRcIjoge1xuICAgICAgICAgICAgICBzdHJpbmcgKz0gZGlnaXRzKHZhbHVlLCAyKTtcbiAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgICAgICB0aHJvdyBFcnJvcihcbiAgICAgICAgICAgICAgICBgRm9ybWF0dGVyRXJyb3I6IHZhbHVlIFwiJHt0b2tlbi52YWx1ZX1cIiBpcyBub3Qgc3VwcG9ydGVkYCxcbiAgICAgICAgICAgICAgKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cbiAgICAgICAgY2FzZSBcImRheVwiOiB7XG4gICAgICAgICAgY29uc3QgdmFsdWUgPSB1dGMgPyBkYXRlLmdldFVUQ0RhdGUoKSA6IGRhdGUuZ2V0RGF0ZSgpO1xuICAgICAgICAgIHN3aXRjaCAodG9rZW4udmFsdWUpIHtcbiAgICAgICAgICAgIGNhc2UgXCJudW1lcmljXCI6IHtcbiAgICAgICAgICAgICAgc3RyaW5nICs9IHZhbHVlO1xuICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGNhc2UgXCIyLWRpZ2l0XCI6IHtcbiAgICAgICAgICAgICAgc3RyaW5nICs9IGRpZ2l0cyh2YWx1ZSwgMik7XG4gICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICAgICAgdGhyb3cgRXJyb3IoXG4gICAgICAgICAgICAgICAgYEZvcm1hdHRlckVycm9yOiB2YWx1ZSBcIiR7dG9rZW4udmFsdWV9XCIgaXMgbm90IHN1cHBvcnRlZGAsXG4gICAgICAgICAgICAgICk7XG4gICAgICAgICAgfVxuICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9XG4gICAgICAgIGNhc2UgXCJob3VyXCI6IHtcbiAgICAgICAgICBsZXQgdmFsdWUgPSB1dGMgPyBkYXRlLmdldFVUQ0hvdXJzKCkgOiBkYXRlLmdldEhvdXJzKCk7XG4gICAgICAgICAgdmFsdWUgLT0gdG9rZW4uaG91cjEyICYmIGRhdGUuZ2V0SG91cnMoKSA+IDEyID8gMTIgOiAwO1xuICAgICAgICAgIHN3aXRjaCAodG9rZW4udmFsdWUpIHtcbiAgICAgICAgICAgIGNhc2UgXCJudW1lcmljXCI6IHtcbiAgICAgICAgICAgICAgc3RyaW5nICs9IHZhbHVlO1xuICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGNhc2UgXCIyLWRpZ2l0XCI6IHtcbiAgICAgICAgICAgICAgc3RyaW5nICs9IGRpZ2l0cyh2YWx1ZSwgMik7XG4gICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICAgICAgdGhyb3cgRXJyb3IoXG4gICAgICAgICAgICAgICAgYEZvcm1hdHRlckVycm9yOiB2YWx1ZSBcIiR7dG9rZW4udmFsdWV9XCIgaXMgbm90IHN1cHBvcnRlZGAsXG4gICAgICAgICAgICAgICk7XG4gICAgICAgICAgfVxuICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9XG4gICAgICAgIGNhc2UgXCJtaW51dGVcIjoge1xuICAgICAgICAgIGNvbnN0IHZhbHVlID0gdXRjID8gZGF0ZS5nZXRVVENNaW51dGVzKCkgOiBkYXRlLmdldE1pbnV0ZXMoKTtcbiAgICAgICAgICBzd2l0Y2ggKHRva2VuLnZhbHVlKSB7XG4gICAgICAgICAgICBjYXNlIFwibnVtZXJpY1wiOiB7XG4gICAgICAgICAgICAgIHN0cmluZyArPSB2YWx1ZTtcbiAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBjYXNlIFwiMi1kaWdpdFwiOiB7XG4gICAgICAgICAgICAgIHN0cmluZyArPSBkaWdpdHModmFsdWUsIDIpO1xuICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgICAgIHRocm93IEVycm9yKFxuICAgICAgICAgICAgICAgIGBGb3JtYXR0ZXJFcnJvcjogdmFsdWUgXCIke3Rva2VuLnZhbHVlfVwiIGlzIG5vdCBzdXBwb3J0ZWRgLFxuICAgICAgICAgICAgICApO1xuICAgICAgICAgIH1cbiAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuICAgICAgICBjYXNlIFwic2Vjb25kXCI6IHtcbiAgICAgICAgICBjb25zdCB2YWx1ZSA9IHV0YyA/IGRhdGUuZ2V0VVRDU2Vjb25kcygpIDogZGF0ZS5nZXRTZWNvbmRzKCk7XG4gICAgICAgICAgc3dpdGNoICh0b2tlbi52YWx1ZSkge1xuICAgICAgICAgICAgY2FzZSBcIm51bWVyaWNcIjoge1xuICAgICAgICAgICAgICBzdHJpbmcgKz0gdmFsdWU7XG4gICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgY2FzZSBcIjItZGlnaXRcIjoge1xuICAgICAgICAgICAgICBzdHJpbmcgKz0gZGlnaXRzKHZhbHVlLCAyKTtcbiAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgICAgICB0aHJvdyBFcnJvcihcbiAgICAgICAgICAgICAgICBgRm9ybWF0dGVyRXJyb3I6IHZhbHVlIFwiJHt0b2tlbi52YWx1ZX1cIiBpcyBub3Qgc3VwcG9ydGVkYCxcbiAgICAgICAgICAgICAgKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cbiAgICAgICAgY2FzZSBcImZyYWN0aW9uYWxTZWNvbmRcIjoge1xuICAgICAgICAgIGNvbnN0IHZhbHVlID0gdXRjXG4gICAgICAgICAgICA/IGRhdGUuZ2V0VVRDTWlsbGlzZWNvbmRzKClcbiAgICAgICAgICAgIDogZGF0ZS5nZXRNaWxsaXNlY29uZHMoKTtcbiAgICAgICAgICBzdHJpbmcgKz0gZGlnaXRzKHZhbHVlLCBOdW1iZXIodG9rZW4udmFsdWUpKTtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuICAgICAgICAvLyBGSVhNRShiYXJ0bG9taWVqdSlcbiAgICAgICAgY2FzZSBcInRpbWVab25lTmFtZVwiOiB7XG4gICAgICAgICAgLy8gc3RyaW5nICs9IHV0YyA/IFwiWlwiIDogdG9rZW4udmFsdWVcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuICAgICAgICBjYXNlIFwiZGF5UGVyaW9kXCI6IHtcbiAgICAgICAgICBzdHJpbmcgKz0gdG9rZW4udmFsdWUgPyAoZGF0ZS5nZXRIb3VycygpID49IDEyID8gXCJQTVwiIDogXCJBTVwiKSA6IFwiXCI7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cbiAgICAgICAgY2FzZSBcImxpdGVyYWxcIjoge1xuICAgICAgICAgIHN0cmluZyArPSB0b2tlbi52YWx1ZTtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuXG4gICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgdGhyb3cgRXJyb3IoYEZvcm1hdHRlckVycm9yOiB7ICR7dG9rZW4udHlwZX0gJHt0b2tlbi52YWx1ZX0gfWApO1xuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBzdHJpbmc7XG4gIH1cblxuICBwYXJzZVRvUGFydHMoc3RyaW5nOiBzdHJpbmcpOiBEYXRlVGltZUZvcm1hdFBhcnRbXSB7XG4gICAgY29uc3QgcGFydHM6IERhdGVUaW1lRm9ybWF0UGFydFtdID0gW107XG5cbiAgICBmb3IgKGNvbnN0IHRva2VuIG9mIHRoaXMuI2Zvcm1hdCkge1xuICAgICAgY29uc3QgdHlwZSA9IHRva2VuLnR5cGU7XG5cbiAgICAgIGxldCB2YWx1ZSA9IFwiXCI7XG4gICAgICBzd2l0Y2ggKHRva2VuLnR5cGUpIHtcbiAgICAgICAgY2FzZSBcInllYXJcIjoge1xuICAgICAgICAgIHN3aXRjaCAodG9rZW4udmFsdWUpIHtcbiAgICAgICAgICAgIGNhc2UgXCJudW1lcmljXCI6IHtcbiAgICAgICAgICAgICAgdmFsdWUgPSAvXlxcZHsxLDR9Ly5leGVjKHN0cmluZyk/LlswXSBhcyBzdHJpbmc7XG4gICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgY2FzZSBcIjItZGlnaXRcIjoge1xuICAgICAgICAgICAgICB2YWx1ZSA9IC9eXFxkezEsMn0vLmV4ZWMoc3RyaW5nKT8uWzBdIGFzIHN0cmluZztcbiAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9XG4gICAgICAgIGNhc2UgXCJtb250aFwiOiB7XG4gICAgICAgICAgc3dpdGNoICh0b2tlbi52YWx1ZSkge1xuICAgICAgICAgICAgY2FzZSBcIm51bWVyaWNcIjoge1xuICAgICAgICAgICAgICB2YWx1ZSA9IC9eXFxkezEsMn0vLmV4ZWMoc3RyaW5nKT8uWzBdIGFzIHN0cmluZztcbiAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBjYXNlIFwiMi1kaWdpdFwiOiB7XG4gICAgICAgICAgICAgIHZhbHVlID0gL15cXGR7Mn0vLmV4ZWMoc3RyaW5nKT8uWzBdIGFzIHN0cmluZztcbiAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBjYXNlIFwibmFycm93XCI6IHtcbiAgICAgICAgICAgICAgdmFsdWUgPSAvXlthLXpBLVpdKy8uZXhlYyhzdHJpbmcpPy5bMF0gYXMgc3RyaW5nO1xuICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGNhc2UgXCJzaG9ydFwiOiB7XG4gICAgICAgICAgICAgIHZhbHVlID0gL15bYS16QS1aXSsvLmV4ZWMoc3RyaW5nKT8uWzBdIGFzIHN0cmluZztcbiAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBjYXNlIFwibG9uZ1wiOiB7XG4gICAgICAgICAgICAgIHZhbHVlID0gL15bYS16QS1aXSsvLmV4ZWMoc3RyaW5nKT8uWzBdIGFzIHN0cmluZztcbiAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgICAgICB0aHJvdyBFcnJvcihcbiAgICAgICAgICAgICAgICBgUGFyc2VyRXJyb3I6IHZhbHVlIFwiJHt0b2tlbi52YWx1ZX1cIiBpcyBub3Qgc3VwcG9ydGVkYCxcbiAgICAgICAgICAgICAgKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cbiAgICAgICAgY2FzZSBcImRheVwiOiB7XG4gICAgICAgICAgc3dpdGNoICh0b2tlbi52YWx1ZSkge1xuICAgICAgICAgICAgY2FzZSBcIm51bWVyaWNcIjoge1xuICAgICAgICAgICAgICB2YWx1ZSA9IC9eXFxkezEsMn0vLmV4ZWMoc3RyaW5nKT8uWzBdIGFzIHN0cmluZztcbiAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBjYXNlIFwiMi1kaWdpdFwiOiB7XG4gICAgICAgICAgICAgIHZhbHVlID0gL15cXGR7Mn0vLmV4ZWMoc3RyaW5nKT8uWzBdIGFzIHN0cmluZztcbiAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgICAgICB0aHJvdyBFcnJvcihcbiAgICAgICAgICAgICAgICBgUGFyc2VyRXJyb3I6IHZhbHVlIFwiJHt0b2tlbi52YWx1ZX1cIiBpcyBub3Qgc3VwcG9ydGVkYCxcbiAgICAgICAgICAgICAgKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cbiAgICAgICAgY2FzZSBcImhvdXJcIjoge1xuICAgICAgICAgIHN3aXRjaCAodG9rZW4udmFsdWUpIHtcbiAgICAgICAgICAgIGNhc2UgXCJudW1lcmljXCI6IHtcbiAgICAgICAgICAgICAgdmFsdWUgPSAvXlxcZHsxLDJ9Ly5leGVjKHN0cmluZyk/LlswXSBhcyBzdHJpbmc7XG4gICAgICAgICAgICAgIGlmICh0b2tlbi5ob3VyMTIgJiYgcGFyc2VJbnQodmFsdWUpID4gMTIpIHtcbiAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKFxuICAgICAgICAgICAgICAgICAgYFRyeWluZyB0byBwYXJzZSBob3VyIGdyZWF0ZXIgdGhhbiAxMi4gVXNlICdIJyBpbnN0ZWFkIG9mICdoJy5gLFxuICAgICAgICAgICAgICAgICk7XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBjYXNlIFwiMi1kaWdpdFwiOiB7XG4gICAgICAgICAgICAgIHZhbHVlID0gL15cXGR7Mn0vLmV4ZWMoc3RyaW5nKT8uWzBdIGFzIHN0cmluZztcbiAgICAgICAgICAgICAgaWYgKHRva2VuLmhvdXIxMiAmJiBwYXJzZUludCh2YWx1ZSkgPiAxMikge1xuICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoXG4gICAgICAgICAgICAgICAgICBgVHJ5aW5nIHRvIHBhcnNlIGhvdXIgZ3JlYXRlciB0aGFuIDEyLiBVc2UgJ0hIJyBpbnN0ZWFkIG9mICdoaCcuYCxcbiAgICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICAgICAgdGhyb3cgRXJyb3IoXG4gICAgICAgICAgICAgICAgYFBhcnNlckVycm9yOiB2YWx1ZSBcIiR7dG9rZW4udmFsdWV9XCIgaXMgbm90IHN1cHBvcnRlZGAsXG4gICAgICAgICAgICAgICk7XG4gICAgICAgICAgfVxuICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9XG4gICAgICAgIGNhc2UgXCJtaW51dGVcIjoge1xuICAgICAgICAgIHN3aXRjaCAodG9rZW4udmFsdWUpIHtcbiAgICAgICAgICAgIGNhc2UgXCJudW1lcmljXCI6IHtcbiAgICAgICAgICAgICAgdmFsdWUgPSAvXlxcZHsxLDJ9Ly5leGVjKHN0cmluZyk/LlswXSBhcyBzdHJpbmc7XG4gICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgY2FzZSBcIjItZGlnaXRcIjoge1xuICAgICAgICAgICAgICB2YWx1ZSA9IC9eXFxkezJ9Ly5leGVjKHN0cmluZyk/LlswXSBhcyBzdHJpbmc7XG4gICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICAgICAgdGhyb3cgRXJyb3IoXG4gICAgICAgICAgICAgICAgYFBhcnNlckVycm9yOiB2YWx1ZSBcIiR7dG9rZW4udmFsdWV9XCIgaXMgbm90IHN1cHBvcnRlZGAsXG4gICAgICAgICAgICAgICk7XG4gICAgICAgICAgfVxuICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9XG4gICAgICAgIGNhc2UgXCJzZWNvbmRcIjoge1xuICAgICAgICAgIHN3aXRjaCAodG9rZW4udmFsdWUpIHtcbiAgICAgICAgICAgIGNhc2UgXCJudW1lcmljXCI6IHtcbiAgICAgICAgICAgICAgdmFsdWUgPSAvXlxcZHsxLDJ9Ly5leGVjKHN0cmluZyk/LlswXSBhcyBzdHJpbmc7XG4gICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgY2FzZSBcIjItZGlnaXRcIjoge1xuICAgICAgICAgICAgICB2YWx1ZSA9IC9eXFxkezJ9Ly5leGVjKHN0cmluZyk/LlswXSBhcyBzdHJpbmc7XG4gICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICAgICAgdGhyb3cgRXJyb3IoXG4gICAgICAgICAgICAgICAgYFBhcnNlckVycm9yOiB2YWx1ZSBcIiR7dG9rZW4udmFsdWV9XCIgaXMgbm90IHN1cHBvcnRlZGAsXG4gICAgICAgICAgICAgICk7XG4gICAgICAgICAgfVxuICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9XG4gICAgICAgIGNhc2UgXCJmcmFjdGlvbmFsU2Vjb25kXCI6IHtcbiAgICAgICAgICB2YWx1ZSA9IG5ldyBSZWdFeHAoYF5cXFxcZHske3Rva2VuLnZhbHVlfX1gKS5leGVjKHN0cmluZylcbiAgICAgICAgICAgID8uWzBdIGFzIHN0cmluZztcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuICAgICAgICBjYXNlIFwidGltZVpvbmVOYW1lXCI6IHtcbiAgICAgICAgICB2YWx1ZSA9IHRva2VuLnZhbHVlIGFzIHN0cmluZztcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuICAgICAgICBjYXNlIFwiZGF5UGVyaW9kXCI6IHtcbiAgICAgICAgICB2YWx1ZSA9IC9eKEF8UClNLy5leGVjKHN0cmluZyk/LlswXSBhcyBzdHJpbmc7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cbiAgICAgICAgY2FzZSBcImxpdGVyYWxcIjoge1xuICAgICAgICAgIGlmICghc3RyaW5nLnN0YXJ0c1dpdGgodG9rZW4udmFsdWUgYXMgc3RyaW5nKSkge1xuICAgICAgICAgICAgdGhyb3cgRXJyb3IoXG4gICAgICAgICAgICAgIGBMaXRlcmFsIFwiJHt0b2tlbi52YWx1ZX1cIiBub3QgZm91bmQgXCIke3N0cmluZy5zbGljZSgwLCAyNSl9XCJgLFxuICAgICAgICAgICAgKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgdmFsdWUgPSB0b2tlbi52YWx1ZSBhcyBzdHJpbmc7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cblxuICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgIHRocm93IEVycm9yKGAke3Rva2VuLnR5cGV9ICR7dG9rZW4udmFsdWV9YCk7XG4gICAgICB9XG5cbiAgICAgIGlmICghdmFsdWUpIHtcbiAgICAgICAgdGhyb3cgRXJyb3IoXG4gICAgICAgICAgYHZhbHVlIG5vdCB2YWxpZCBmb3IgdG9rZW4geyAke3R5cGV9ICR7dmFsdWV9IH0gJHtcbiAgICAgICAgICAgIHN0cmluZy5zbGljZShcbiAgICAgICAgICAgICAgMCxcbiAgICAgICAgICAgICAgMjUsXG4gICAgICAgICAgICApXG4gICAgICAgICAgfWAsXG4gICAgICAgICk7XG4gICAgICB9XG4gICAgICBwYXJ0cy5wdXNoKHsgdHlwZSwgdmFsdWUgfSk7XG5cbiAgICAgIHN0cmluZyA9IHN0cmluZy5zbGljZSh2YWx1ZS5sZW5ndGgpO1xuICAgIH1cblxuICAgIGlmIChzdHJpbmcubGVuZ3RoKSB7XG4gICAgICB0aHJvdyBFcnJvcihcbiAgICAgICAgYGRhdGV0aW1lIHN0cmluZyB3YXMgbm90IGZ1bGx5IHBhcnNlZCEgJHtzdHJpbmcuc2xpY2UoMCwgMjUpfWAsXG4gICAgICApO1xuICAgIH1cblxuICAgIHJldHVybiBwYXJ0cztcbiAgfVxuXG4gIC8qKiBzb3J0ICYgZmlsdGVyIGRhdGVUaW1lRm9ybWF0UGFydCAqL1xuICBzb3J0RGF0ZVRpbWVGb3JtYXRQYXJ0KHBhcnRzOiBEYXRlVGltZUZvcm1hdFBhcnRbXSk6IERhdGVUaW1lRm9ybWF0UGFydFtdIHtcbiAgICBsZXQgcmVzdWx0OiBEYXRlVGltZUZvcm1hdFBhcnRbXSA9IFtdO1xuICAgIGNvbnN0IHR5cGVBcnJheSA9IFtcbiAgICAgIFwieWVhclwiLFxuICAgICAgXCJtb250aFwiLFxuICAgICAgXCJkYXlcIixcbiAgICAgIFwiaG91clwiLFxuICAgICAgXCJtaW51dGVcIixcbiAgICAgIFwic2Vjb25kXCIsXG4gICAgICBcImZyYWN0aW9uYWxTZWNvbmRcIixcbiAgICBdO1xuICAgIGZvciAoY29uc3QgdHlwZSBvZiB0eXBlQXJyYXkpIHtcbiAgICAgIGNvbnN0IGN1cnJlbnQgPSBwYXJ0cy5maW5kSW5kZXgoKGVsKSA9PiBlbC50eXBlID09PSB0eXBlKTtcbiAgICAgIGlmIChjdXJyZW50ICE9PSAtMSkge1xuICAgICAgICByZXN1bHQgPSByZXN1bHQuY29uY2F0KHBhcnRzLnNwbGljZShjdXJyZW50LCAxKSk7XG4gICAgICB9XG4gICAgfVxuICAgIHJlc3VsdCA9IHJlc3VsdC5jb25jYXQocGFydHMpO1xuICAgIHJldHVybiByZXN1bHQ7XG4gIH1cblxuICBwYXJ0c1RvRGF0ZShwYXJ0czogRGF0ZVRpbWVGb3JtYXRQYXJ0W10pOiBEYXRlIHtcbiAgICBjb25zdCBkYXRlID0gbmV3IERhdGUoKTtcbiAgICBjb25zdCB1dGMgPSBwYXJ0cy5maW5kKFxuICAgICAgKHBhcnQpID0+IHBhcnQudHlwZSA9PT0gXCJ0aW1lWm9uZU5hbWVcIiAmJiBwYXJ0LnZhbHVlID09PSBcIlVUQ1wiLFxuICAgICk7XG5cbiAgICB1dGMgPyBkYXRlLnNldFVUQ0hvdXJzKDAsIDAsIDAsIDApIDogZGF0ZS5zZXRIb3VycygwLCAwLCAwLCAwKTtcbiAgICBmb3IgKGNvbnN0IHBhcnQgb2YgcGFydHMpIHtcbiAgICAgIHN3aXRjaCAocGFydC50eXBlKSB7XG4gICAgICAgIGNhc2UgXCJ5ZWFyXCI6IHtcbiAgICAgICAgICBjb25zdCB2YWx1ZSA9IE51bWJlcihwYXJ0LnZhbHVlLnBhZFN0YXJ0KDQsIFwiMjBcIikpO1xuICAgICAgICAgIHV0YyA/IGRhdGUuc2V0VVRDRnVsbFllYXIodmFsdWUpIDogZGF0ZS5zZXRGdWxsWWVhcih2YWx1ZSk7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cbiAgICAgICAgY2FzZSBcIm1vbnRoXCI6IHtcbiAgICAgICAgICBjb25zdCB2YWx1ZSA9IE51bWJlcihwYXJ0LnZhbHVlKSAtIDE7XG4gICAgICAgICAgdXRjID8gZGF0ZS5zZXRVVENNb250aCh2YWx1ZSkgOiBkYXRlLnNldE1vbnRoKHZhbHVlKTtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuICAgICAgICBjYXNlIFwiZGF5XCI6IHtcbiAgICAgICAgICBjb25zdCB2YWx1ZSA9IE51bWJlcihwYXJ0LnZhbHVlKTtcbiAgICAgICAgICB1dGMgPyBkYXRlLnNldFVUQ0RhdGUodmFsdWUpIDogZGF0ZS5zZXREYXRlKHZhbHVlKTtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuICAgICAgICBjYXNlIFwiaG91clwiOiB7XG4gICAgICAgICAgbGV0IHZhbHVlID0gTnVtYmVyKHBhcnQudmFsdWUpO1xuICAgICAgICAgIGNvbnN0IGRheVBlcmlvZCA9IHBhcnRzLmZpbmQoXG4gICAgICAgICAgICAocGFydDogRGF0ZVRpbWVGb3JtYXRQYXJ0KSA9PiBwYXJ0LnR5cGUgPT09IFwiZGF5UGVyaW9kXCIsXG4gICAgICAgICAgKTtcbiAgICAgICAgICBpZiAoZGF5UGVyaW9kPy52YWx1ZSA9PT0gXCJQTVwiKSB2YWx1ZSArPSAxMjtcbiAgICAgICAgICB1dGMgPyBkYXRlLnNldFVUQ0hvdXJzKHZhbHVlKSA6IGRhdGUuc2V0SG91cnModmFsdWUpO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9XG4gICAgICAgIGNhc2UgXCJtaW51dGVcIjoge1xuICAgICAgICAgIGNvbnN0IHZhbHVlID0gTnVtYmVyKHBhcnQudmFsdWUpO1xuICAgICAgICAgIHV0YyA/IGRhdGUuc2V0VVRDTWludXRlcyh2YWx1ZSkgOiBkYXRlLnNldE1pbnV0ZXModmFsdWUpO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9XG4gICAgICAgIGNhc2UgXCJzZWNvbmRcIjoge1xuICAgICAgICAgIGNvbnN0IHZhbHVlID0gTnVtYmVyKHBhcnQudmFsdWUpO1xuICAgICAgICAgIHV0YyA/IGRhdGUuc2V0VVRDU2Vjb25kcyh2YWx1ZSkgOiBkYXRlLnNldFNlY29uZHModmFsdWUpO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9XG4gICAgICAgIGNhc2UgXCJmcmFjdGlvbmFsU2Vjb25kXCI6IHtcbiAgICAgICAgICBjb25zdCB2YWx1ZSA9IE51bWJlcihwYXJ0LnZhbHVlKTtcbiAgICAgICAgICB1dGMgPyBkYXRlLnNldFVUQ01pbGxpc2Vjb25kcyh2YWx1ZSkgOiBkYXRlLnNldE1pbGxpc2Vjb25kcyh2YWx1ZSk7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIGRhdGU7XG4gIH1cblxuICBwYXJzZShzdHJpbmc6IHN0cmluZyk6IERhdGUge1xuICAgIGNvbnN0IHBhcnRzID0gdGhpcy5wYXJzZVRvUGFydHMoc3RyaW5nKTtcbiAgICBjb25zdCBzb3J0UGFydHMgPSB0aGlzLnNvcnREYXRlVGltZUZvcm1hdFBhcnQocGFydHMpO1xuICAgIHJldHVybiB0aGlzLnBhcnRzVG9EYXRlKHNvcnRQYXJ0cyk7XG4gIH1cbn1cbiJdLCJuYW1lcyI6W10sIm1h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