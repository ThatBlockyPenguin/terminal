// Copyright 2018-2022 the Deno authors. All rights reserved. MIT license.
// This module is browser compatible. Do not rely on good formatting of values
// for AssertionError messages in browsers.
import { red, stripColor } from "../fmt/colors.ts";
import { buildMessage, diff, diffstr } from "./_diff.ts";
import { format } from "./_format.ts";
const CAN_NOT_DISPLAY = "[Cannot display]";
export class AssertionError extends Error {
    name = "AssertionError";
    constructor(message){
        super(message);
    }
}
function isKeyedCollection(x) {
    return [
        Symbol.iterator,
        "size"
    ].every((k)=>k in x
    );
}
/**
 * Deep equality comparison used in assertions
 * @param c actual value
 * @param d expected value
 */ export function equal(c, d) {
    const seen = new Map();
    return (function compare(a, b) {
        // Have to render RegExp & Date for string comparison
        // unless it's mistreated as object
        if (a && b && (a instanceof RegExp && b instanceof RegExp || a instanceof URL && b instanceof URL)) {
            return String(a) === String(b);
        }
        if (a instanceof Date && b instanceof Date) {
            const aTime = a.getTime();
            const bTime = b.getTime();
            // Check for NaN equality manually since NaN is not
            // equal to itself.
            if (Number.isNaN(aTime) && Number.isNaN(bTime)) {
                return true;
            }
            return aTime === bTime;
        }
        if (typeof a === "number" && typeof b === "number") {
            return Number.isNaN(a) && Number.isNaN(b) || a === b;
        }
        if (Object.is(a, b)) {
            return true;
        }
        if (a && typeof a === "object" && b && typeof b === "object") {
            if (a && b && !constructorsEqual(a, b)) {
                return false;
            }
            if (a instanceof WeakMap || b instanceof WeakMap) {
                if (!(a instanceof WeakMap && b instanceof WeakMap)) return false;
                throw new TypeError("cannot compare WeakMap instances");
            }
            if (a instanceof WeakSet || b instanceof WeakSet) {
                if (!(a instanceof WeakSet && b instanceof WeakSet)) return false;
                throw new TypeError("cannot compare WeakSet instances");
            }
            if (seen.get(a) === b) {
                return true;
            }
            if (Object.keys(a || {
            }).length !== Object.keys(b || {
            }).length) {
                return false;
            }
            if (isKeyedCollection(a) && isKeyedCollection(b)) {
                if (a.size !== b.size) {
                    return false;
                }
                let unmatchedEntries = a.size;
                for (const [aKey, aValue] of a.entries()){
                    for (const [bKey, bValue] of b.entries()){
                        /* Given that Map keys can be references, we need
             * to ensure that they are also deeply equal */ if (aKey === aValue && bKey === bValue && compare(aKey, bKey) || compare(aKey, bKey) && compare(aValue, bValue)) {
                            unmatchedEntries--;
                        }
                    }
                }
                return unmatchedEntries === 0;
            }
            const merged = {
                ...a,
                ...b
            };
            for (const key of [
                ...Object.getOwnPropertyNames(merged),
                ...Object.getOwnPropertySymbols(merged), 
            ]){
                if (!compare(a && a[key], b && b[key])) {
                    return false;
                }
                if (key in a && !(key in b) || key in b && !(key in a)) {
                    return false;
                }
            }
            seen.set(a, b);
            if (a instanceof WeakRef || b instanceof WeakRef) {
                if (!(a instanceof WeakRef && b instanceof WeakRef)) return false;
                return compare(a.deref(), b.deref());
            }
            return true;
        }
        return false;
    })(c, d);
}
// deno-lint-ignore ban-types
function constructorsEqual(a, b) {
    return a.constructor === b.constructor || a.constructor === Object && !b.constructor || !a.constructor && b.constructor === Object;
}
/** Make an assertion, error will be thrown if `expr` does not have truthy value. */ export function assert(expr, msg = "") {
    if (!expr) {
        throw new AssertionError(msg);
    }
}
export function assertEquals(actual, expected, msg) {
    if (equal(actual, expected)) {
        return;
    }
    let message = "";
    const actualString = format(actual);
    const expectedString = format(expected);
    try {
        const stringDiff = typeof actual === "string" && typeof expected === "string";
        const diffResult = stringDiff ? diffstr(actual, expected) : diff(actualString.split("\n"), expectedString.split("\n"));
        const diffMsg = buildMessage(diffResult, {
            stringDiff
        }).join("\n");
        message = `Values are not equal:\n${diffMsg}`;
    } catch  {
        message = `\n${red(CAN_NOT_DISPLAY)} + \n\n`;
    }
    if (msg) {
        message = msg;
    }
    throw new AssertionError(message);
}
export function assertNotEquals(actual, expected, msg) {
    if (!equal(actual, expected)) {
        return;
    }
    let actualString;
    let expectedString;
    try {
        actualString = String(actual);
    } catch  {
        actualString = "[Cannot display]";
    }
    try {
        expectedString = String(expected);
    } catch  {
        expectedString = "[Cannot display]";
    }
    if (!msg) {
        msg = `actual: ${actualString} expected not to be: ${expectedString}`;
    }
    throw new AssertionError(msg);
}
/**
 * Make an assertion that `actual` and `expected` are strictly equal. If
 * not then throw.
 *
 * ```ts
 * import { assertStrictEquals } from "./asserts.ts";
 *
 * assertStrictEquals(1, 2)
 * ```
 */ export function assertStrictEquals(actual, expected, msg) {
    if (actual === expected) {
        return;
    }
    let message;
    if (msg) {
        message = msg;
    } else {
        const actualString = format(actual);
        const expectedString = format(expected);
        if (actualString === expectedString) {
            const withOffset = actualString.split("\n").map((l)=>`    ${l}`
            ).join("\n");
            message = `Values have the same structure but are not reference-equal:\n\n${red(withOffset)}\n`;
        } else {
            try {
                const stringDiff = typeof actual === "string" && typeof expected === "string";
                const diffResult = stringDiff ? diffstr(actual, expected) : diff(actualString.split("\n"), expectedString.split("\n"));
                const diffMsg = buildMessage(diffResult, {
                    stringDiff
                }).join("\n");
                message = `Values are not strictly equal:\n${diffMsg}`;
            } catch  {
                message = `\n${red(CAN_NOT_DISPLAY)} + \n\n`;
            }
        }
    }
    throw new AssertionError(message);
}
export function assertNotStrictEquals(actual, expected, msg) {
    if (actual !== expected) {
        return;
    }
    throw new AssertionError(msg ?? `Expected "actual" to be strictly unequal to: ${format(actual)}\n`);
}
/**
 * Make an assertion that `actual` and `expected` are almost equal numbers through
 * a given tolerance. It can be used to take into account IEEE-754 double-precision
 * floating-point representation limitations.
 * If the values are not almost equal then throw.
 *
 * ```ts
 * import { assertAlmostEquals, assertThrows } from "./asserts.ts";
 *
 * assertAlmostEquals(0.1, 0.2);
 *
 * // Using a custom tolerance value
 * assertAlmostEquals(0.1 + 0.2, 0.3, 1e-16);
 * assertThrows(() => assertAlmostEquals(0.1 + 0.2, 0.3, 1e-17));
 * ```
 */ export function assertAlmostEquals(actual, expected, tolerance = 0.0000001, msg) {
    if (actual === expected) {
        return;
    }
    const delta = Math.abs(expected - actual);
    if (delta <= tolerance) {
        return;
    }
    const f = (n)=>Number.isInteger(n) ? n : n.toExponential()
    ;
    throw new AssertionError(msg ?? `actual: "${f(actual)}" expected to be close to "${f(expected)}": \
delta "${f(delta)}" is greater than "${f(tolerance)}"`);
}
/**
 * Make an assertion that `obj` is an instance of `type`.
 * If not then throw.
 */ export function assertInstanceOf(actual, expectedType, msg = "") {
    if (!msg) {
        const expectedTypeStr = expectedType.name;
        let actualTypeStr = "";
        if (actual === null) {
            actualTypeStr = "null";
        } else if (actual === undefined) {
            actualTypeStr = "undefined";
        } else if (typeof actual === "object") {
            actualTypeStr = actual.constructor?.name ?? "Object";
        } else {
            actualTypeStr = typeof actual;
        }
        if (expectedTypeStr == actualTypeStr) {
            msg = `Expected object to be an instance of "${expectedTypeStr}".`;
        } else if (actualTypeStr == "function") {
            msg = `Expected object to be an instance of "${expectedTypeStr}" but was not an instanced object.`;
        } else {
            msg = `Expected object to be an instance of "${expectedTypeStr}" but was "${actualTypeStr}".`;
        }
    }
    assert(actual instanceof expectedType, msg);
}
/**
 * Make an assertion that actual is not null or undefined.
 * If not then throw.
 */ export function assertExists(actual, msg) {
    if (actual === undefined || actual === null) {
        if (!msg) {
            msg = `actual: "${actual}" expected to not be null or undefined`;
        }
        throw new AssertionError(msg);
    }
}
/**
 * Make an assertion that actual includes expected. If not
 * then throw.
 */ export function assertStringIncludes(actual, expected, msg) {
    if (!actual.includes(expected)) {
        if (!msg) {
            msg = `actual: "${actual}" expected to contain: "${expected}"`;
        }
        throw new AssertionError(msg);
    }
}
export function assertArrayIncludes(actual, expected, msg) {
    const missing = [];
    for(let i = 0; i < expected.length; i++){
        let found = false;
        for(let j = 0; j < actual.length; j++){
            if (equal(expected[i], actual[j])) {
                found = true;
                break;
            }
        }
        if (!found) {
            missing.push(expected[i]);
        }
    }
    if (missing.length === 0) {
        return;
    }
    if (!msg) {
        msg = `actual: "${format(actual)}" expected to include: "${format(expected)}"\nmissing: ${format(missing)}`;
    }
    throw new AssertionError(msg);
}
/**
 * Make an assertion that `actual` match RegExp `expected`. If not
 * then throw.
 */ export function assertMatch(actual, expected, msg) {
    if (!expected.test(actual)) {
        if (!msg) {
            msg = `actual: "${actual}" expected to match: "${expected}"`;
        }
        throw new AssertionError(msg);
    }
}
/**
 * Make an assertion that `actual` not match RegExp `expected`. If match
 * then throw.
 */ export function assertNotMatch(actual, expected, msg) {
    if (expected.test(actual)) {
        if (!msg) {
            msg = `actual: "${actual}" expected to not match: "${expected}"`;
        }
        throw new AssertionError(msg);
    }
}
/**
 * Make an assertion that `actual` object is a subset of `expected` object, deeply.
 * If not, then throw.
 */ export function assertObjectMatch(// deno-lint-ignore no-explicit-any
actual, expected) {
    function filter(a, b) {
        const seen = new WeakMap();
        return fn(a, b);
        function fn(a, b) {
            // Prevent infinite loop with circular references with same filter
            if (seen.has(a) && seen.get(a) === b) {
                return a;
            }
            seen.set(a, b);
            // Filter keys and symbols which are present in both actual and expected
            const filtered = {
            };
            const entries = [
                ...Object.getOwnPropertyNames(a),
                ...Object.getOwnPropertySymbols(a), 
            ].filter((key)=>key in b
            ).map((key)=>[
                    key,
                    a[key]
                ]
            );
            for (const [key, value] of entries){
                // On array references, build a filtered array and filter nested objects inside
                if (Array.isArray(value)) {
                    const subset = b[key];
                    if (Array.isArray(subset)) {
                        filtered[key] = fn({
                            ...value
                        }, {
                            ...subset
                        });
                        continue;
                    }
                } else if (value instanceof RegExp) {
                    filtered[key] = value;
                    continue;
                } else if (typeof value === "object") {
                    const subset = b[key];
                    if (typeof subset === "object" && subset) {
                        // When both operands are maps, build a filtered map with common keys and filter nested objects inside
                        if (value instanceof Map && subset instanceof Map) {
                            filtered[key] = new Map([
                                ...value
                            ].filter(([k])=>subset.has(k)
                            ).map(([k, v])=>[
                                    k,
                                    typeof v === "object" ? fn(v, subset.get(k)) : v
                                ]
                            ));
                            continue;
                        }
                        // When both operands are set, build a filtered set with common values
                        if (value instanceof Set && subset instanceof Set) {
                            filtered[key] = new Set([
                                ...value
                            ].filter((v)=>subset.has(v)
                            ));
                            continue;
                        }
                        filtered[key] = fn(value, subset);
                        continue;
                    }
                }
                filtered[key] = value;
            }
            return filtered;
        }
    }
    return assertEquals(// get the intersection of "actual" and "expected"
    // side effect: all the instances' constructor field is "Object" now.
    filter(actual, expected), // set (nested) instances' constructor field to be "Object" without changing expected value.
    // see https://github.com/denoland/deno_std/pull/1419
    filter(expected, expected));
}
/**
 * Forcefully throws a failed assertion
 */ export function fail(msg) {
    assert(false, `Failed assertion${msg ? `: ${msg}` : "."}`);
}
/**
 * Make an assertion that `error` is an `Error`.
 * If not then an error will be thrown.
 * An error class and a string that should be included in the
 * error message can also be asserted.
 */ export function assertIsError(error, // deno-lint-ignore no-explicit-any
ErrorClass, msgIncludes, msg) {
    if (error instanceof Error === false) {
        throw new AssertionError(`Expected "error" to be an Error object.`);
    }
    if (ErrorClass && !(error instanceof ErrorClass)) {
        msg = `Expected error to be instance of "${ErrorClass.name}", but was "${typeof error === "object" ? error?.constructor?.name : "[not an object]"}"${msg ? `: ${msg}` : "."}`;
        throw new AssertionError(msg);
    }
    if (msgIncludes && (!(error instanceof Error) || !stripColor(error.message).includes(stripColor(msgIncludes)))) {
        msg = `Expected error message to include "${msgIncludes}", but got "${error instanceof Error ? error.message : "[not an Error]"}"${msg ? `: ${msg}` : "."}`;
        throw new AssertionError(msg);
    }
}
export function assertThrows(fn, errorClassOrCallback, msgIncludesOrMsg, msg) {
    // deno-lint-ignore no-explicit-any
    let ErrorClass = undefined;
    let msgIncludes = undefined;
    let errorCallback;
    if (errorClassOrCallback == null || errorClassOrCallback.prototype instanceof Error || errorClassOrCallback.prototype === Error.prototype) {
        // deno-lint-ignore no-explicit-any
        ErrorClass = errorClassOrCallback;
        msgIncludes = msgIncludesOrMsg;
        errorCallback = null;
    } else {
        errorCallback = errorClassOrCallback;
        msg = msgIncludesOrMsg;
    }
    let doesThrow = false;
    try {
        fn();
    } catch (error) {
        if (error instanceof Error === false) {
            throw new AssertionError("A non-Error object was thrown.");
        }
        assertIsError(error, ErrorClass, msgIncludes, msg);
        if (typeof errorCallback == "function") {
            errorCallback(error);
        }
        doesThrow = true;
    }
    if (!doesThrow) {
        msg = `Expected function to throw${msg ? `: ${msg}` : "."}`;
        throw new AssertionError(msg);
    }
}
export async function assertRejects(fn, errorClassOrCallback, msgIncludesOrMsg, msg) {
    // deno-lint-ignore no-explicit-any
    let ErrorClass = undefined;
    let msgIncludes = undefined;
    let errorCallback;
    if (errorClassOrCallback == null || errorClassOrCallback.prototype instanceof Error || errorClassOrCallback.prototype === Error.prototype) {
        // deno-lint-ignore no-explicit-any
        ErrorClass = errorClassOrCallback;
        msgIncludes = msgIncludesOrMsg;
        errorCallback = null;
    } else {
        errorCallback = errorClassOrCallback;
        msg = msgIncludesOrMsg;
    }
    let doesThrow = false;
    try {
        await fn();
    } catch (error) {
        if (error instanceof Error === false) {
            throw new AssertionError("A non-Error object was thrown or rejected.");
        }
        assertIsError(error, ErrorClass, msgIncludes, msg);
        if (typeof errorCallback == "function") {
            errorCallback(error);
        }
        doesThrow = true;
    }
    if (!doesThrow) {
        msg = `Expected function to throw${msg ? `: ${msg}` : "."}`;
        throw new AssertionError(msg);
    }
}
/** Use this to stub out methods that will throw when invoked. */ export function unimplemented(msg) {
    throw new AssertionError(msg || "unimplemented");
}
/** Use this to assert unreachable code. */ export function unreachable() {
    throw new AssertionError("unreachable");
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbImh0dHBzOi8vZGVuby5sYW5kL3N0ZEAwLjEzNy4wL3Rlc3RpbmcvYXNzZXJ0cy50cyJdLCJzb3VyY2VzQ29udGVudCI6WyIvLyBDb3B5cmlnaHQgMjAxOC0yMDIyIHRoZSBEZW5vIGF1dGhvcnMuIEFsbCByaWdodHMgcmVzZXJ2ZWQuIE1JVCBsaWNlbnNlLlxuLy8gVGhpcyBtb2R1bGUgaXMgYnJvd3NlciBjb21wYXRpYmxlLiBEbyBub3QgcmVseSBvbiBnb29kIGZvcm1hdHRpbmcgb2YgdmFsdWVzXG4vLyBmb3IgQXNzZXJ0aW9uRXJyb3IgbWVzc2FnZXMgaW4gYnJvd3NlcnMuXG5cbmltcG9ydCB7IHJlZCwgc3RyaXBDb2xvciB9IGZyb20gXCIuLi9mbXQvY29sb3JzLnRzXCI7XG5pbXBvcnQgeyBidWlsZE1lc3NhZ2UsIGRpZmYsIGRpZmZzdHIgfSBmcm9tIFwiLi9fZGlmZi50c1wiO1xuaW1wb3J0IHsgZm9ybWF0IH0gZnJvbSBcIi4vX2Zvcm1hdC50c1wiO1xuXG5jb25zdCBDQU5fTk9UX0RJU1BMQVkgPSBcIltDYW5ub3QgZGlzcGxheV1cIjtcblxuZXhwb3J0IGNsYXNzIEFzc2VydGlvbkVycm9yIGV4dGVuZHMgRXJyb3Ige1xuICBvdmVycmlkZSBuYW1lID0gXCJBc3NlcnRpb25FcnJvclwiO1xuICBjb25zdHJ1Y3RvcihtZXNzYWdlOiBzdHJpbmcpIHtcbiAgICBzdXBlcihtZXNzYWdlKTtcbiAgfVxufVxuXG5mdW5jdGlvbiBpc0tleWVkQ29sbGVjdGlvbih4OiB1bmtub3duKTogeCBpcyBTZXQ8dW5rbm93bj4ge1xuICByZXR1cm4gW1N5bWJvbC5pdGVyYXRvciwgXCJzaXplXCJdLmV2ZXJ5KChrKSA9PiBrIGluICh4IGFzIFNldDx1bmtub3duPikpO1xufVxuXG4vKipcbiAqIERlZXAgZXF1YWxpdHkgY29tcGFyaXNvbiB1c2VkIGluIGFzc2VydGlvbnNcbiAqIEBwYXJhbSBjIGFjdHVhbCB2YWx1ZVxuICogQHBhcmFtIGQgZXhwZWN0ZWQgdmFsdWVcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGVxdWFsKGM6IHVua25vd24sIGQ6IHVua25vd24pOiBib29sZWFuIHtcbiAgY29uc3Qgc2VlbiA9IG5ldyBNYXAoKTtcbiAgcmV0dXJuIChmdW5jdGlvbiBjb21wYXJlKGE6IHVua25vd24sIGI6IHVua25vd24pOiBib29sZWFuIHtcbiAgICAvLyBIYXZlIHRvIHJlbmRlciBSZWdFeHAgJiBEYXRlIGZvciBzdHJpbmcgY29tcGFyaXNvblxuICAgIC8vIHVubGVzcyBpdCdzIG1pc3RyZWF0ZWQgYXMgb2JqZWN0XG4gICAgaWYgKFxuICAgICAgYSAmJlxuICAgICAgYiAmJlxuICAgICAgKChhIGluc3RhbmNlb2YgUmVnRXhwICYmIGIgaW5zdGFuY2VvZiBSZWdFeHApIHx8XG4gICAgICAgIChhIGluc3RhbmNlb2YgVVJMICYmIGIgaW5zdGFuY2VvZiBVUkwpKVxuICAgICkge1xuICAgICAgcmV0dXJuIFN0cmluZyhhKSA9PT0gU3RyaW5nKGIpO1xuICAgIH1cbiAgICBpZiAoYSBpbnN0YW5jZW9mIERhdGUgJiYgYiBpbnN0YW5jZW9mIERhdGUpIHtcbiAgICAgIGNvbnN0IGFUaW1lID0gYS5nZXRUaW1lKCk7XG4gICAgICBjb25zdCBiVGltZSA9IGIuZ2V0VGltZSgpO1xuICAgICAgLy8gQ2hlY2sgZm9yIE5hTiBlcXVhbGl0eSBtYW51YWxseSBzaW5jZSBOYU4gaXMgbm90XG4gICAgICAvLyBlcXVhbCB0byBpdHNlbGYuXG4gICAgICBpZiAoTnVtYmVyLmlzTmFOKGFUaW1lKSAmJiBOdW1iZXIuaXNOYU4oYlRpbWUpKSB7XG4gICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgfVxuICAgICAgcmV0dXJuIGFUaW1lID09PSBiVGltZTtcbiAgICB9XG4gICAgaWYgKHR5cGVvZiBhID09PSBcIm51bWJlclwiICYmIHR5cGVvZiBiID09PSBcIm51bWJlclwiKSB7XG4gICAgICByZXR1cm4gTnVtYmVyLmlzTmFOKGEpICYmIE51bWJlci5pc05hTihiKSB8fCBhID09PSBiO1xuICAgIH1cbiAgICBpZiAoT2JqZWN0LmlzKGEsIGIpKSB7XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG4gICAgaWYgKGEgJiYgdHlwZW9mIGEgPT09IFwib2JqZWN0XCIgJiYgYiAmJiB0eXBlb2YgYiA9PT0gXCJvYmplY3RcIikge1xuICAgICAgaWYgKGEgJiYgYiAmJiAhY29uc3RydWN0b3JzRXF1YWwoYSwgYikpIHtcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgfVxuICAgICAgaWYgKGEgaW5zdGFuY2VvZiBXZWFrTWFwIHx8IGIgaW5zdGFuY2VvZiBXZWFrTWFwKSB7XG4gICAgICAgIGlmICghKGEgaW5zdGFuY2VvZiBXZWFrTWFwICYmIGIgaW5zdGFuY2VvZiBXZWFrTWFwKSkgcmV0dXJuIGZhbHNlO1xuICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKFwiY2Fubm90IGNvbXBhcmUgV2Vha01hcCBpbnN0YW5jZXNcIik7XG4gICAgICB9XG4gICAgICBpZiAoYSBpbnN0YW5jZW9mIFdlYWtTZXQgfHwgYiBpbnN0YW5jZW9mIFdlYWtTZXQpIHtcbiAgICAgICAgaWYgKCEoYSBpbnN0YW5jZW9mIFdlYWtTZXQgJiYgYiBpbnN0YW5jZW9mIFdlYWtTZXQpKSByZXR1cm4gZmFsc2U7XG4gICAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoXCJjYW5ub3QgY29tcGFyZSBXZWFrU2V0IGluc3RhbmNlc1wiKTtcbiAgICAgIH1cbiAgICAgIGlmIChzZWVuLmdldChhKSA9PT0gYikge1xuICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgIH1cbiAgICAgIGlmIChPYmplY3Qua2V5cyhhIHx8IHt9KS5sZW5ndGggIT09IE9iamVjdC5rZXlzKGIgfHwge30pLmxlbmd0aCkge1xuICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICB9XG4gICAgICBpZiAoaXNLZXllZENvbGxlY3Rpb24oYSkgJiYgaXNLZXllZENvbGxlY3Rpb24oYikpIHtcbiAgICAgICAgaWYgKGEuc2l6ZSAhPT0gYi5zaXplKSB7XG4gICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICB9XG5cbiAgICAgICAgbGV0IHVubWF0Y2hlZEVudHJpZXMgPSBhLnNpemU7XG5cbiAgICAgICAgZm9yIChjb25zdCBbYUtleSwgYVZhbHVlXSBvZiBhLmVudHJpZXMoKSkge1xuICAgICAgICAgIGZvciAoY29uc3QgW2JLZXksIGJWYWx1ZV0gb2YgYi5lbnRyaWVzKCkpIHtcbiAgICAgICAgICAgIC8qIEdpdmVuIHRoYXQgTWFwIGtleXMgY2FuIGJlIHJlZmVyZW5jZXMsIHdlIG5lZWRcbiAgICAgICAgICAgICAqIHRvIGVuc3VyZSB0aGF0IHRoZXkgYXJlIGFsc28gZGVlcGx5IGVxdWFsICovXG4gICAgICAgICAgICBpZiAoXG4gICAgICAgICAgICAgIChhS2V5ID09PSBhVmFsdWUgJiYgYktleSA9PT0gYlZhbHVlICYmIGNvbXBhcmUoYUtleSwgYktleSkpIHx8XG4gICAgICAgICAgICAgIChjb21wYXJlKGFLZXksIGJLZXkpICYmIGNvbXBhcmUoYVZhbHVlLCBiVmFsdWUpKVxuICAgICAgICAgICAgKSB7XG4gICAgICAgICAgICAgIHVubWF0Y2hlZEVudHJpZXMtLTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gdW5tYXRjaGVkRW50cmllcyA9PT0gMDtcbiAgICAgIH1cbiAgICAgIGNvbnN0IG1lcmdlZCA9IHsgLi4uYSwgLi4uYiB9O1xuICAgICAgZm9yIChcbiAgICAgICAgY29uc3Qga2V5IG9mIFtcbiAgICAgICAgICAuLi5PYmplY3QuZ2V0T3duUHJvcGVydHlOYW1lcyhtZXJnZWQpLFxuICAgICAgICAgIC4uLk9iamVjdC5nZXRPd25Qcm9wZXJ0eVN5bWJvbHMobWVyZ2VkKSxcbiAgICAgICAgXVxuICAgICAgKSB7XG4gICAgICAgIHR5cGUgS2V5ID0ga2V5b2YgdHlwZW9mIG1lcmdlZDtcbiAgICAgICAgaWYgKCFjb21wYXJlKGEgJiYgYVtrZXkgYXMgS2V5XSwgYiAmJiBiW2tleSBhcyBLZXldKSkge1xuICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoKChrZXkgaW4gYSkgJiYgKCEoa2V5IGluIGIpKSkgfHwgKChrZXkgaW4gYikgJiYgKCEoa2V5IGluIGEpKSkpIHtcbiAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIHNlZW4uc2V0KGEsIGIpO1xuICAgICAgaWYgKGEgaW5zdGFuY2VvZiBXZWFrUmVmIHx8IGIgaW5zdGFuY2VvZiBXZWFrUmVmKSB7XG4gICAgICAgIGlmICghKGEgaW5zdGFuY2VvZiBXZWFrUmVmICYmIGIgaW5zdGFuY2VvZiBXZWFrUmVmKSkgcmV0dXJuIGZhbHNlO1xuICAgICAgICByZXR1cm4gY29tcGFyZShhLmRlcmVmKCksIGIuZGVyZWYoKSk7XG4gICAgICB9XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9KShjLCBkKTtcbn1cblxuLy8gZGVuby1saW50LWlnbm9yZSBiYW4tdHlwZXNcbmZ1bmN0aW9uIGNvbnN0cnVjdG9yc0VxdWFsKGE6IG9iamVjdCwgYjogb2JqZWN0KSB7XG4gIHJldHVybiBhLmNvbnN0cnVjdG9yID09PSBiLmNvbnN0cnVjdG9yIHx8XG4gICAgYS5jb25zdHJ1Y3RvciA9PT0gT2JqZWN0ICYmICFiLmNvbnN0cnVjdG9yIHx8XG4gICAgIWEuY29uc3RydWN0b3IgJiYgYi5jb25zdHJ1Y3RvciA9PT0gT2JqZWN0O1xufVxuXG4vKiogTWFrZSBhbiBhc3NlcnRpb24sIGVycm9yIHdpbGwgYmUgdGhyb3duIGlmIGBleHByYCBkb2VzIG5vdCBoYXZlIHRydXRoeSB2YWx1ZS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBhc3NlcnQoZXhwcjogdW5rbm93biwgbXNnID0gXCJcIik6IGFzc2VydHMgZXhwciB7XG4gIGlmICghZXhwcikge1xuICAgIHRocm93IG5ldyBBc3NlcnRpb25FcnJvcihtc2cpO1xuICB9XG59XG5cbi8qKlxuICogTWFrZSBhbiBhc3NlcnRpb24gdGhhdCBgYWN0dWFsYCBhbmQgYGV4cGVjdGVkYCBhcmUgZXF1YWwsIGRlZXBseS4gSWYgbm90XG4gKiBkZWVwbHkgZXF1YWwsIHRoZW4gdGhyb3cuXG4gKlxuICogVHlwZSBwYXJhbWV0ZXIgY2FuIGJlIHNwZWNpZmllZCB0byBlbnN1cmUgdmFsdWVzIHVuZGVyIGNvbXBhcmlzb24gaGF2ZSB0aGUgc2FtZSB0eXBlLlxuICogRm9yIGV4YW1wbGU6XG4gKiBgYGB0c1xuICogaW1wb3J0IHsgYXNzZXJ0RXF1YWxzIH0gZnJvbSBcIi4vYXNzZXJ0cy50c1wiO1xuICpcbiAqIGFzc2VydEVxdWFsczxudW1iZXI+KDEsIDIpXG4gKiBgYGBcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGFzc2VydEVxdWFscyhcbiAgYWN0dWFsOiB1bmtub3duLFxuICBleHBlY3RlZDogdW5rbm93bixcbiAgbXNnPzogc3RyaW5nLFxuKTogdm9pZDtcbmV4cG9ydCBmdW5jdGlvbiBhc3NlcnRFcXVhbHM8VD4oYWN0dWFsOiBULCBleHBlY3RlZDogVCwgbXNnPzogc3RyaW5nKTogdm9pZDtcbmV4cG9ydCBmdW5jdGlvbiBhc3NlcnRFcXVhbHMoXG4gIGFjdHVhbDogdW5rbm93bixcbiAgZXhwZWN0ZWQ6IHVua25vd24sXG4gIG1zZz86IHN0cmluZyxcbik6IHZvaWQge1xuICBpZiAoZXF1YWwoYWN0dWFsLCBleHBlY3RlZCkpIHtcbiAgICByZXR1cm47XG4gIH1cbiAgbGV0IG1lc3NhZ2UgPSBcIlwiO1xuICBjb25zdCBhY3R1YWxTdHJpbmcgPSBmb3JtYXQoYWN0dWFsKTtcbiAgY29uc3QgZXhwZWN0ZWRTdHJpbmcgPSBmb3JtYXQoZXhwZWN0ZWQpO1xuICB0cnkge1xuICAgIGNvbnN0IHN0cmluZ0RpZmYgPSAodHlwZW9mIGFjdHVhbCA9PT0gXCJzdHJpbmdcIikgJiZcbiAgICAgICh0eXBlb2YgZXhwZWN0ZWQgPT09IFwic3RyaW5nXCIpO1xuICAgIGNvbnN0IGRpZmZSZXN1bHQgPSBzdHJpbmdEaWZmXG4gICAgICA/IGRpZmZzdHIoYWN0dWFsIGFzIHN0cmluZywgZXhwZWN0ZWQgYXMgc3RyaW5nKVxuICAgICAgOiBkaWZmKGFjdHVhbFN0cmluZy5zcGxpdChcIlxcblwiKSwgZXhwZWN0ZWRTdHJpbmcuc3BsaXQoXCJcXG5cIikpO1xuICAgIGNvbnN0IGRpZmZNc2cgPSBidWlsZE1lc3NhZ2UoZGlmZlJlc3VsdCwgeyBzdHJpbmdEaWZmIH0pLmpvaW4oXCJcXG5cIik7XG4gICAgbWVzc2FnZSA9IGBWYWx1ZXMgYXJlIG5vdCBlcXVhbDpcXG4ke2RpZmZNc2d9YDtcbiAgfSBjYXRjaCB7XG4gICAgbWVzc2FnZSA9IGBcXG4ke3JlZChDQU5fTk9UX0RJU1BMQVkpfSArIFxcblxcbmA7XG4gIH1cbiAgaWYgKG1zZykge1xuICAgIG1lc3NhZ2UgPSBtc2c7XG4gIH1cbiAgdGhyb3cgbmV3IEFzc2VydGlvbkVycm9yKG1lc3NhZ2UpO1xufVxuXG4vKipcbiAqIE1ha2UgYW4gYXNzZXJ0aW9uIHRoYXQgYGFjdHVhbGAgYW5kIGBleHBlY3RlZGAgYXJlIG5vdCBlcXVhbCwgZGVlcGx5LlxuICogSWYgbm90IHRoZW4gdGhyb3cuXG4gKlxuICogVHlwZSBwYXJhbWV0ZXIgY2FuIGJlIHNwZWNpZmllZCB0byBlbnN1cmUgdmFsdWVzIHVuZGVyIGNvbXBhcmlzb24gaGF2ZSB0aGUgc2FtZSB0eXBlLlxuICogRm9yIGV4YW1wbGU6XG4gKiBgYGB0c1xuICogaW1wb3J0IHsgYXNzZXJ0Tm90RXF1YWxzIH0gZnJvbSBcIi4vYXNzZXJ0cy50c1wiO1xuICpcbiAqIGFzc2VydE5vdEVxdWFsczxudW1iZXI+KDEsIDIpXG4gKiBgYGBcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGFzc2VydE5vdEVxdWFscyhcbiAgYWN0dWFsOiB1bmtub3duLFxuICBleHBlY3RlZDogdW5rbm93bixcbiAgbXNnPzogc3RyaW5nLFxuKTogdm9pZDtcbmV4cG9ydCBmdW5jdGlvbiBhc3NlcnROb3RFcXVhbHM8VD4oYWN0dWFsOiBULCBleHBlY3RlZDogVCwgbXNnPzogc3RyaW5nKTogdm9pZDtcbmV4cG9ydCBmdW5jdGlvbiBhc3NlcnROb3RFcXVhbHMoXG4gIGFjdHVhbDogdW5rbm93bixcbiAgZXhwZWN0ZWQ6IHVua25vd24sXG4gIG1zZz86IHN0cmluZyxcbik6IHZvaWQge1xuICBpZiAoIWVxdWFsKGFjdHVhbCwgZXhwZWN0ZWQpKSB7XG4gICAgcmV0dXJuO1xuICB9XG4gIGxldCBhY3R1YWxTdHJpbmc6IHN0cmluZztcbiAgbGV0IGV4cGVjdGVkU3RyaW5nOiBzdHJpbmc7XG4gIHRyeSB7XG4gICAgYWN0dWFsU3RyaW5nID0gU3RyaW5nKGFjdHVhbCk7XG4gIH0gY2F0Y2gge1xuICAgIGFjdHVhbFN0cmluZyA9IFwiW0Nhbm5vdCBkaXNwbGF5XVwiO1xuICB9XG4gIHRyeSB7XG4gICAgZXhwZWN0ZWRTdHJpbmcgPSBTdHJpbmcoZXhwZWN0ZWQpO1xuICB9IGNhdGNoIHtcbiAgICBleHBlY3RlZFN0cmluZyA9IFwiW0Nhbm5vdCBkaXNwbGF5XVwiO1xuICB9XG4gIGlmICghbXNnKSB7XG4gICAgbXNnID0gYGFjdHVhbDogJHthY3R1YWxTdHJpbmd9IGV4cGVjdGVkIG5vdCB0byBiZTogJHtleHBlY3RlZFN0cmluZ31gO1xuICB9XG4gIHRocm93IG5ldyBBc3NlcnRpb25FcnJvcihtc2cpO1xufVxuXG4vKipcbiAqIE1ha2UgYW4gYXNzZXJ0aW9uIHRoYXQgYGFjdHVhbGAgYW5kIGBleHBlY3RlZGAgYXJlIHN0cmljdGx5IGVxdWFsLiBJZlxuICogbm90IHRoZW4gdGhyb3cuXG4gKlxuICogYGBgdHNcbiAqIGltcG9ydCB7IGFzc2VydFN0cmljdEVxdWFscyB9IGZyb20gXCIuL2Fzc2VydHMudHNcIjtcbiAqXG4gKiBhc3NlcnRTdHJpY3RFcXVhbHMoMSwgMilcbiAqIGBgYFxuICovXG5leHBvcnQgZnVuY3Rpb24gYXNzZXJ0U3RyaWN0RXF1YWxzPFQ+KFxuICBhY3R1YWw6IHVua25vd24sXG4gIGV4cGVjdGVkOiBULFxuICBtc2c/OiBzdHJpbmcsXG4pOiBhc3NlcnRzIGFjdHVhbCBpcyBUIHtcbiAgaWYgKGFjdHVhbCA9PT0gZXhwZWN0ZWQpIHtcbiAgICByZXR1cm47XG4gIH1cblxuICBsZXQgbWVzc2FnZTogc3RyaW5nO1xuXG4gIGlmIChtc2cpIHtcbiAgICBtZXNzYWdlID0gbXNnO1xuICB9IGVsc2Uge1xuICAgIGNvbnN0IGFjdHVhbFN0cmluZyA9IGZvcm1hdChhY3R1YWwpO1xuICAgIGNvbnN0IGV4cGVjdGVkU3RyaW5nID0gZm9ybWF0KGV4cGVjdGVkKTtcblxuICAgIGlmIChhY3R1YWxTdHJpbmcgPT09IGV4cGVjdGVkU3RyaW5nKSB7XG4gICAgICBjb25zdCB3aXRoT2Zmc2V0ID0gYWN0dWFsU3RyaW5nXG4gICAgICAgIC5zcGxpdChcIlxcblwiKVxuICAgICAgICAubWFwKChsKSA9PiBgICAgICR7bH1gKVxuICAgICAgICAuam9pbihcIlxcblwiKTtcbiAgICAgIG1lc3NhZ2UgPVxuICAgICAgICBgVmFsdWVzIGhhdmUgdGhlIHNhbWUgc3RydWN0dXJlIGJ1dCBhcmUgbm90IHJlZmVyZW5jZS1lcXVhbDpcXG5cXG4ke1xuICAgICAgICAgIHJlZCh3aXRoT2Zmc2V0KVxuICAgICAgICB9XFxuYDtcbiAgICB9IGVsc2Uge1xuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3Qgc3RyaW5nRGlmZiA9ICh0eXBlb2YgYWN0dWFsID09PSBcInN0cmluZ1wiKSAmJlxuICAgICAgICAgICh0eXBlb2YgZXhwZWN0ZWQgPT09IFwic3RyaW5nXCIpO1xuICAgICAgICBjb25zdCBkaWZmUmVzdWx0ID0gc3RyaW5nRGlmZlxuICAgICAgICAgID8gZGlmZnN0cihhY3R1YWwgYXMgc3RyaW5nLCBleHBlY3RlZCBhcyBzdHJpbmcpXG4gICAgICAgICAgOiBkaWZmKGFjdHVhbFN0cmluZy5zcGxpdChcIlxcblwiKSwgZXhwZWN0ZWRTdHJpbmcuc3BsaXQoXCJcXG5cIikpO1xuICAgICAgICBjb25zdCBkaWZmTXNnID0gYnVpbGRNZXNzYWdlKGRpZmZSZXN1bHQsIHsgc3RyaW5nRGlmZiB9KS5qb2luKFwiXFxuXCIpO1xuICAgICAgICBtZXNzYWdlID0gYFZhbHVlcyBhcmUgbm90IHN0cmljdGx5IGVxdWFsOlxcbiR7ZGlmZk1zZ31gO1xuICAgICAgfSBjYXRjaCB7XG4gICAgICAgIG1lc3NhZ2UgPSBgXFxuJHtyZWQoQ0FOX05PVF9ESVNQTEFZKX0gKyBcXG5cXG5gO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIHRocm93IG5ldyBBc3NlcnRpb25FcnJvcihtZXNzYWdlKTtcbn1cblxuLyoqXG4gKiBNYWtlIGFuIGFzc2VydGlvbiB0aGF0IGBhY3R1YWxgIGFuZCBgZXhwZWN0ZWRgIGFyZSBub3Qgc3RyaWN0bHkgZXF1YWwuXG4gKiBJZiB0aGUgdmFsdWVzIGFyZSBzdHJpY3RseSBlcXVhbCB0aGVuIHRocm93LlxuICpcbiAqIGBgYHRzXG4gKiBpbXBvcnQgeyBhc3NlcnROb3RTdHJpY3RFcXVhbHMgfSBmcm9tIFwiLi9hc3NlcnRzLnRzXCI7XG4gKlxuICogYXNzZXJ0Tm90U3RyaWN0RXF1YWxzKDEsIDEpXG4gKiBgYGBcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGFzc2VydE5vdFN0cmljdEVxdWFscyhcbiAgYWN0dWFsOiB1bmtub3duLFxuICBleHBlY3RlZDogdW5rbm93bixcbiAgbXNnPzogc3RyaW5nLFxuKTogdm9pZDtcbmV4cG9ydCBmdW5jdGlvbiBhc3NlcnROb3RTdHJpY3RFcXVhbHM8VD4oXG4gIGFjdHVhbDogVCxcbiAgZXhwZWN0ZWQ6IFQsXG4gIG1zZz86IHN0cmluZyxcbik6IHZvaWQ7XG5leHBvcnQgZnVuY3Rpb24gYXNzZXJ0Tm90U3RyaWN0RXF1YWxzKFxuICBhY3R1YWw6IHVua25vd24sXG4gIGV4cGVjdGVkOiB1bmtub3duLFxuICBtc2c/OiBzdHJpbmcsXG4pOiB2b2lkIHtcbiAgaWYgKGFjdHVhbCAhPT0gZXhwZWN0ZWQpIHtcbiAgICByZXR1cm47XG4gIH1cblxuICB0aHJvdyBuZXcgQXNzZXJ0aW9uRXJyb3IoXG4gICAgbXNnID8/IGBFeHBlY3RlZCBcImFjdHVhbFwiIHRvIGJlIHN0cmljdGx5IHVuZXF1YWwgdG86ICR7Zm9ybWF0KGFjdHVhbCl9XFxuYCxcbiAgKTtcbn1cblxuLyoqXG4gKiBNYWtlIGFuIGFzc2VydGlvbiB0aGF0IGBhY3R1YWxgIGFuZCBgZXhwZWN0ZWRgIGFyZSBhbG1vc3QgZXF1YWwgbnVtYmVycyB0aHJvdWdoXG4gKiBhIGdpdmVuIHRvbGVyYW5jZS4gSXQgY2FuIGJlIHVzZWQgdG8gdGFrZSBpbnRvIGFjY291bnQgSUVFRS03NTQgZG91YmxlLXByZWNpc2lvblxuICogZmxvYXRpbmctcG9pbnQgcmVwcmVzZW50YXRpb24gbGltaXRhdGlvbnMuXG4gKiBJZiB0aGUgdmFsdWVzIGFyZSBub3QgYWxtb3N0IGVxdWFsIHRoZW4gdGhyb3cuXG4gKlxuICogYGBgdHNcbiAqIGltcG9ydCB7IGFzc2VydEFsbW9zdEVxdWFscywgYXNzZXJ0VGhyb3dzIH0gZnJvbSBcIi4vYXNzZXJ0cy50c1wiO1xuICpcbiAqIGFzc2VydEFsbW9zdEVxdWFscygwLjEsIDAuMik7XG4gKlxuICogLy8gVXNpbmcgYSBjdXN0b20gdG9sZXJhbmNlIHZhbHVlXG4gKiBhc3NlcnRBbG1vc3RFcXVhbHMoMC4xICsgMC4yLCAwLjMsIDFlLTE2KTtcbiAqIGFzc2VydFRocm93cygoKSA9PiBhc3NlcnRBbG1vc3RFcXVhbHMoMC4xICsgMC4yLCAwLjMsIDFlLTE3KSk7XG4gKiBgYGBcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGFzc2VydEFsbW9zdEVxdWFscyhcbiAgYWN0dWFsOiBudW1iZXIsXG4gIGV4cGVjdGVkOiBudW1iZXIsXG4gIHRvbGVyYW5jZSA9IDFlLTcsXG4gIG1zZz86IHN0cmluZyxcbikge1xuICBpZiAoYWN0dWFsID09PSBleHBlY3RlZCkge1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCBkZWx0YSA9IE1hdGguYWJzKGV4cGVjdGVkIC0gYWN0dWFsKTtcbiAgaWYgKGRlbHRhIDw9IHRvbGVyYW5jZSkge1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCBmID0gKG46IG51bWJlcikgPT4gTnVtYmVyLmlzSW50ZWdlcihuKSA/IG4gOiBuLnRvRXhwb25lbnRpYWwoKTtcbiAgdGhyb3cgbmV3IEFzc2VydGlvbkVycm9yKFxuICAgIG1zZyA/P1xuICAgICAgYGFjdHVhbDogXCIke2YoYWN0dWFsKX1cIiBleHBlY3RlZCB0byBiZSBjbG9zZSB0byBcIiR7ZihleHBlY3RlZCl9XCI6IFxcXG5kZWx0YSBcIiR7ZihkZWx0YSl9XCIgaXMgZ3JlYXRlciB0aGFuIFwiJHtmKHRvbGVyYW5jZSl9XCJgLFxuICApO1xufVxuXG4vLyBkZW5vLWxpbnQtaWdub3JlIG5vLWV4cGxpY2l0LWFueVxudHlwZSBBbnlDb25zdHJ1Y3RvciA9IG5ldyAoLi4uYXJnczogYW55W10pID0+IGFueTtcbnR5cGUgR2V0Q29uc3RydWN0b3JUeXBlPFQgZXh0ZW5kcyBBbnlDb25zdHJ1Y3Rvcj4gPSBUIGV4dGVuZHMgLy8gZGVuby1saW50LWlnbm9yZSBuby1leHBsaWNpdC1hbnlcbm5ldyAoLi4uYXJnczogYW55KSA9PiBpbmZlciBDID8gQ1xuICA6IG5ldmVyO1xuXG4vKipcbiAqIE1ha2UgYW4gYXNzZXJ0aW9uIHRoYXQgYG9iamAgaXMgYW4gaW5zdGFuY2Ugb2YgYHR5cGVgLlxuICogSWYgbm90IHRoZW4gdGhyb3cuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBhc3NlcnRJbnN0YW5jZU9mPFQgZXh0ZW5kcyBBbnlDb25zdHJ1Y3Rvcj4oXG4gIGFjdHVhbDogdW5rbm93bixcbiAgZXhwZWN0ZWRUeXBlOiBULFxuICBtc2cgPSBcIlwiLFxuKTogYXNzZXJ0cyBhY3R1YWwgaXMgR2V0Q29uc3RydWN0b3JUeXBlPFQ+IHtcbiAgaWYgKCFtc2cpIHtcbiAgICBjb25zdCBleHBlY3RlZFR5cGVTdHIgPSBleHBlY3RlZFR5cGUubmFtZTtcblxuICAgIGxldCBhY3R1YWxUeXBlU3RyID0gXCJcIjtcbiAgICBpZiAoYWN0dWFsID09PSBudWxsKSB7XG4gICAgICBhY3R1YWxUeXBlU3RyID0gXCJudWxsXCI7XG4gICAgfSBlbHNlIGlmIChhY3R1YWwgPT09IHVuZGVmaW5lZCkge1xuICAgICAgYWN0dWFsVHlwZVN0ciA9IFwidW5kZWZpbmVkXCI7XG4gICAgfSBlbHNlIGlmICh0eXBlb2YgYWN0dWFsID09PSBcIm9iamVjdFwiKSB7XG4gICAgICBhY3R1YWxUeXBlU3RyID0gYWN0dWFsLmNvbnN0cnVjdG9yPy5uYW1lID8/IFwiT2JqZWN0XCI7XG4gICAgfSBlbHNlIHtcbiAgICAgIGFjdHVhbFR5cGVTdHIgPSB0eXBlb2YgYWN0dWFsO1xuICAgIH1cblxuICAgIGlmIChleHBlY3RlZFR5cGVTdHIgPT0gYWN0dWFsVHlwZVN0cikge1xuICAgICAgbXNnID0gYEV4cGVjdGVkIG9iamVjdCB0byBiZSBhbiBpbnN0YW5jZSBvZiBcIiR7ZXhwZWN0ZWRUeXBlU3RyfVwiLmA7XG4gICAgfSBlbHNlIGlmIChhY3R1YWxUeXBlU3RyID09IFwiZnVuY3Rpb25cIikge1xuICAgICAgbXNnID1cbiAgICAgICAgYEV4cGVjdGVkIG9iamVjdCB0byBiZSBhbiBpbnN0YW5jZSBvZiBcIiR7ZXhwZWN0ZWRUeXBlU3RyfVwiIGJ1dCB3YXMgbm90IGFuIGluc3RhbmNlZCBvYmplY3QuYDtcbiAgICB9IGVsc2Uge1xuICAgICAgbXNnID1cbiAgICAgICAgYEV4cGVjdGVkIG9iamVjdCB0byBiZSBhbiBpbnN0YW5jZSBvZiBcIiR7ZXhwZWN0ZWRUeXBlU3RyfVwiIGJ1dCB3YXMgXCIke2FjdHVhbFR5cGVTdHJ9XCIuYDtcbiAgICB9XG4gIH1cbiAgYXNzZXJ0KGFjdHVhbCBpbnN0YW5jZW9mIGV4cGVjdGVkVHlwZSwgbXNnKTtcbn1cblxuLyoqXG4gKiBNYWtlIGFuIGFzc2VydGlvbiB0aGF0IGFjdHVhbCBpcyBub3QgbnVsbCBvciB1bmRlZmluZWQuXG4gKiBJZiBub3QgdGhlbiB0aHJvdy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGFzc2VydEV4aXN0czxUPihcbiAgYWN0dWFsOiBULFxuICBtc2c/OiBzdHJpbmcsXG4pOiBhc3NlcnRzIGFjdHVhbCBpcyBOb25OdWxsYWJsZTxUPiB7XG4gIGlmIChhY3R1YWwgPT09IHVuZGVmaW5lZCB8fCBhY3R1YWwgPT09IG51bGwpIHtcbiAgICBpZiAoIW1zZykge1xuICAgICAgbXNnID0gYGFjdHVhbDogXCIke2FjdHVhbH1cIiBleHBlY3RlZCB0byBub3QgYmUgbnVsbCBvciB1bmRlZmluZWRgO1xuICAgIH1cbiAgICB0aHJvdyBuZXcgQXNzZXJ0aW9uRXJyb3IobXNnKTtcbiAgfVxufVxuXG4vKipcbiAqIE1ha2UgYW4gYXNzZXJ0aW9uIHRoYXQgYWN0dWFsIGluY2x1ZGVzIGV4cGVjdGVkLiBJZiBub3RcbiAqIHRoZW4gdGhyb3cuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBhc3NlcnRTdHJpbmdJbmNsdWRlcyhcbiAgYWN0dWFsOiBzdHJpbmcsXG4gIGV4cGVjdGVkOiBzdHJpbmcsXG4gIG1zZz86IHN0cmluZyxcbik6IHZvaWQge1xuICBpZiAoIWFjdHVhbC5pbmNsdWRlcyhleHBlY3RlZCkpIHtcbiAgICBpZiAoIW1zZykge1xuICAgICAgbXNnID0gYGFjdHVhbDogXCIke2FjdHVhbH1cIiBleHBlY3RlZCB0byBjb250YWluOiBcIiR7ZXhwZWN0ZWR9XCJgO1xuICAgIH1cbiAgICB0aHJvdyBuZXcgQXNzZXJ0aW9uRXJyb3IobXNnKTtcbiAgfVxufVxuXG4vKipcbiAqIE1ha2UgYW4gYXNzZXJ0aW9uIHRoYXQgYGFjdHVhbGAgaW5jbHVkZXMgdGhlIGBleHBlY3RlZGAgdmFsdWVzLlxuICogSWYgbm90IHRoZW4gYW4gZXJyb3Igd2lsbCBiZSB0aHJvd24uXG4gKlxuICogVHlwZSBwYXJhbWV0ZXIgY2FuIGJlIHNwZWNpZmllZCB0byBlbnN1cmUgdmFsdWVzIHVuZGVyIGNvbXBhcmlzb24gaGF2ZSB0aGUgc2FtZSB0eXBlLlxuICogRm9yIGV4YW1wbGU6XG4gKlxuICogYGBgdHNcbiAqIGltcG9ydCB7IGFzc2VydEFycmF5SW5jbHVkZXMgfSBmcm9tIFwiLi9hc3NlcnRzLnRzXCI7XG4gKlxuICogYXNzZXJ0QXJyYXlJbmNsdWRlczxudW1iZXI+KFsxLCAyXSwgWzJdKVxuICogYGBgXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBhc3NlcnRBcnJheUluY2x1ZGVzKFxuICBhY3R1YWw6IEFycmF5TGlrZTx1bmtub3duPixcbiAgZXhwZWN0ZWQ6IEFycmF5TGlrZTx1bmtub3duPixcbiAgbXNnPzogc3RyaW5nLFxuKTogdm9pZDtcbmV4cG9ydCBmdW5jdGlvbiBhc3NlcnRBcnJheUluY2x1ZGVzPFQ+KFxuICBhY3R1YWw6IEFycmF5TGlrZTxUPixcbiAgZXhwZWN0ZWQ6IEFycmF5TGlrZTxUPixcbiAgbXNnPzogc3RyaW5nLFxuKTogdm9pZDtcbmV4cG9ydCBmdW5jdGlvbiBhc3NlcnRBcnJheUluY2x1ZGVzKFxuICBhY3R1YWw6IEFycmF5TGlrZTx1bmtub3duPixcbiAgZXhwZWN0ZWQ6IEFycmF5TGlrZTx1bmtub3duPixcbiAgbXNnPzogc3RyaW5nLFxuKTogdm9pZCB7XG4gIGNvbnN0IG1pc3Npbmc6IHVua25vd25bXSA9IFtdO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IGV4cGVjdGVkLmxlbmd0aDsgaSsrKSB7XG4gICAgbGV0IGZvdW5kID0gZmFsc2U7XG4gICAgZm9yIChsZXQgaiA9IDA7IGogPCBhY3R1YWwubGVuZ3RoOyBqKyspIHtcbiAgICAgIGlmIChlcXVhbChleHBlY3RlZFtpXSwgYWN0dWFsW2pdKSkge1xuICAgICAgICBmb3VuZCA9IHRydWU7XG4gICAgICAgIGJyZWFrO1xuICAgICAgfVxuICAgIH1cbiAgICBpZiAoIWZvdW5kKSB7XG4gICAgICBtaXNzaW5nLnB1c2goZXhwZWN0ZWRbaV0pO1xuICAgIH1cbiAgfVxuICBpZiAobWlzc2luZy5sZW5ndGggPT09IDApIHtcbiAgICByZXR1cm47XG4gIH1cbiAgaWYgKCFtc2cpIHtcbiAgICBtc2cgPSBgYWN0dWFsOiBcIiR7Zm9ybWF0KGFjdHVhbCl9XCIgZXhwZWN0ZWQgdG8gaW5jbHVkZTogXCIke1xuICAgICAgZm9ybWF0KGV4cGVjdGVkKVxuICAgIH1cIlxcbm1pc3Npbmc6ICR7Zm9ybWF0KG1pc3NpbmcpfWA7XG4gIH1cbiAgdGhyb3cgbmV3IEFzc2VydGlvbkVycm9yKG1zZyk7XG59XG5cbi8qKlxuICogTWFrZSBhbiBhc3NlcnRpb24gdGhhdCBgYWN0dWFsYCBtYXRjaCBSZWdFeHAgYGV4cGVjdGVkYC4gSWYgbm90XG4gKiB0aGVuIHRocm93LlxuICovXG5leHBvcnQgZnVuY3Rpb24gYXNzZXJ0TWF0Y2goXG4gIGFjdHVhbDogc3RyaW5nLFxuICBleHBlY3RlZDogUmVnRXhwLFxuICBtc2c/OiBzdHJpbmcsXG4pOiB2b2lkIHtcbiAgaWYgKCFleHBlY3RlZC50ZXN0KGFjdHVhbCkpIHtcbiAgICBpZiAoIW1zZykge1xuICAgICAgbXNnID0gYGFjdHVhbDogXCIke2FjdHVhbH1cIiBleHBlY3RlZCB0byBtYXRjaDogXCIke2V4cGVjdGVkfVwiYDtcbiAgICB9XG4gICAgdGhyb3cgbmV3IEFzc2VydGlvbkVycm9yKG1zZyk7XG4gIH1cbn1cblxuLyoqXG4gKiBNYWtlIGFuIGFzc2VydGlvbiB0aGF0IGBhY3R1YWxgIG5vdCBtYXRjaCBSZWdFeHAgYGV4cGVjdGVkYC4gSWYgbWF0Y2hcbiAqIHRoZW4gdGhyb3cuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBhc3NlcnROb3RNYXRjaChcbiAgYWN0dWFsOiBzdHJpbmcsXG4gIGV4cGVjdGVkOiBSZWdFeHAsXG4gIG1zZz86IHN0cmluZyxcbik6IHZvaWQge1xuICBpZiAoZXhwZWN0ZWQudGVzdChhY3R1YWwpKSB7XG4gICAgaWYgKCFtc2cpIHtcbiAgICAgIG1zZyA9IGBhY3R1YWw6IFwiJHthY3R1YWx9XCIgZXhwZWN0ZWQgdG8gbm90IG1hdGNoOiBcIiR7ZXhwZWN0ZWR9XCJgO1xuICAgIH1cbiAgICB0aHJvdyBuZXcgQXNzZXJ0aW9uRXJyb3IobXNnKTtcbiAgfVxufVxuXG4vKipcbiAqIE1ha2UgYW4gYXNzZXJ0aW9uIHRoYXQgYGFjdHVhbGAgb2JqZWN0IGlzIGEgc3Vic2V0IG9mIGBleHBlY3RlZGAgb2JqZWN0LCBkZWVwbHkuXG4gKiBJZiBub3QsIHRoZW4gdGhyb3cuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBhc3NlcnRPYmplY3RNYXRjaChcbiAgLy8gZGVuby1saW50LWlnbm9yZSBuby1leHBsaWNpdC1hbnlcbiAgYWN0dWFsOiBSZWNvcmQ8UHJvcGVydHlLZXksIGFueT4sXG4gIGV4cGVjdGVkOiBSZWNvcmQ8UHJvcGVydHlLZXksIHVua25vd24+LFxuKTogdm9pZCB7XG4gIHR5cGUgbG9vc2UgPSBSZWNvcmQ8UHJvcGVydHlLZXksIHVua25vd24+O1xuXG4gIGZ1bmN0aW9uIGZpbHRlcihhOiBsb29zZSwgYjogbG9vc2UpIHtcbiAgICBjb25zdCBzZWVuID0gbmV3IFdlYWtNYXAoKTtcbiAgICByZXR1cm4gZm4oYSwgYik7XG5cbiAgICBmdW5jdGlvbiBmbihhOiBsb29zZSwgYjogbG9vc2UpOiBsb29zZSB7XG4gICAgICAvLyBQcmV2ZW50IGluZmluaXRlIGxvb3Agd2l0aCBjaXJjdWxhciByZWZlcmVuY2VzIHdpdGggc2FtZSBmaWx0ZXJcbiAgICAgIGlmICgoc2Vlbi5oYXMoYSkpICYmIChzZWVuLmdldChhKSA9PT0gYikpIHtcbiAgICAgICAgcmV0dXJuIGE7XG4gICAgICB9XG4gICAgICBzZWVuLnNldChhLCBiKTtcbiAgICAgIC8vIEZpbHRlciBrZXlzIGFuZCBzeW1ib2xzIHdoaWNoIGFyZSBwcmVzZW50IGluIGJvdGggYWN0dWFsIGFuZCBleHBlY3RlZFxuICAgICAgY29uc3QgZmlsdGVyZWQgPSB7fSBhcyBsb29zZTtcbiAgICAgIGNvbnN0IGVudHJpZXMgPSBbXG4gICAgICAgIC4uLk9iamVjdC5nZXRPd25Qcm9wZXJ0eU5hbWVzKGEpLFxuICAgICAgICAuLi5PYmplY3QuZ2V0T3duUHJvcGVydHlTeW1ib2xzKGEpLFxuICAgICAgXVxuICAgICAgICAuZmlsdGVyKChrZXkpID0+IGtleSBpbiBiKVxuICAgICAgICAubWFwKChrZXkpID0+IFtrZXksIGFba2V5IGFzIHN0cmluZ11dKSBhcyBBcnJheTxbc3RyaW5nLCB1bmtub3duXT47XG4gICAgICBmb3IgKGNvbnN0IFtrZXksIHZhbHVlXSBvZiBlbnRyaWVzKSB7XG4gICAgICAgIC8vIE9uIGFycmF5IHJlZmVyZW5jZXMsIGJ1aWxkIGEgZmlsdGVyZWQgYXJyYXkgYW5kIGZpbHRlciBuZXN0ZWQgb2JqZWN0cyBpbnNpZGVcbiAgICAgICAgaWYgKEFycmF5LmlzQXJyYXkodmFsdWUpKSB7XG4gICAgICAgICAgY29uc3Qgc3Vic2V0ID0gKGIgYXMgbG9vc2UpW2tleV07XG4gICAgICAgICAgaWYgKEFycmF5LmlzQXJyYXkoc3Vic2V0KSkge1xuICAgICAgICAgICAgZmlsdGVyZWRba2V5XSA9IGZuKHsgLi4udmFsdWUgfSwgeyAuLi5zdWJzZXQgfSk7XG4gICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICB9XG4gICAgICAgIH0gLy8gT24gcmVnZXhwIHJlZmVyZW5jZXMsIGtlZXAgdmFsdWUgYXMgaXQgdG8gYXZvaWQgbG9vc2luZyBwYXR0ZXJuIGFuZCBmbGFnc1xuICAgICAgICBlbHNlIGlmICh2YWx1ZSBpbnN0YW5jZW9mIFJlZ0V4cCkge1xuICAgICAgICAgIGZpbHRlcmVkW2tleV0gPSB2YWx1ZTtcbiAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfSAvLyBPbiBuZXN0ZWQgb2JqZWN0cyByZWZlcmVuY2VzLCBidWlsZCBhIGZpbHRlcmVkIG9iamVjdCByZWN1cnNpdmVseVxuICAgICAgICBlbHNlIGlmICh0eXBlb2YgdmFsdWUgPT09IFwib2JqZWN0XCIpIHtcbiAgICAgICAgICBjb25zdCBzdWJzZXQgPSAoYiBhcyBsb29zZSlba2V5XTtcbiAgICAgICAgICBpZiAoKHR5cGVvZiBzdWJzZXQgPT09IFwib2JqZWN0XCIpICYmIChzdWJzZXQpKSB7XG4gICAgICAgICAgICAvLyBXaGVuIGJvdGggb3BlcmFuZHMgYXJlIG1hcHMsIGJ1aWxkIGEgZmlsdGVyZWQgbWFwIHdpdGggY29tbW9uIGtleXMgYW5kIGZpbHRlciBuZXN0ZWQgb2JqZWN0cyBpbnNpZGVcbiAgICAgICAgICAgIGlmICgodmFsdWUgaW5zdGFuY2VvZiBNYXApICYmIChzdWJzZXQgaW5zdGFuY2VvZiBNYXApKSB7XG4gICAgICAgICAgICAgIGZpbHRlcmVkW2tleV0gPSBuZXcgTWFwKFxuICAgICAgICAgICAgICAgIFsuLi52YWx1ZV0uZmlsdGVyKChba10pID0+IHN1YnNldC5oYXMoaykpLm1hcCgoXG4gICAgICAgICAgICAgICAgICBbaywgdl0sXG4gICAgICAgICAgICAgICAgKSA9PiBbaywgdHlwZW9mIHYgPT09IFwib2JqZWN0XCIgPyBmbih2LCBzdWJzZXQuZ2V0KGspKSA6IHZdKSxcbiAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICAvLyBXaGVuIGJvdGggb3BlcmFuZHMgYXJlIHNldCwgYnVpbGQgYSBmaWx0ZXJlZCBzZXQgd2l0aCBjb21tb24gdmFsdWVzXG4gICAgICAgICAgICBpZiAoKHZhbHVlIGluc3RhbmNlb2YgU2V0KSAmJiAoc3Vic2V0IGluc3RhbmNlb2YgU2V0KSkge1xuICAgICAgICAgICAgICBmaWx0ZXJlZFtrZXldID0gbmV3IFNldChbLi4udmFsdWVdLmZpbHRlcigodikgPT4gc3Vic2V0Lmhhcyh2KSkpO1xuICAgICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGZpbHRlcmVkW2tleV0gPSBmbih2YWx1ZSBhcyBsb29zZSwgc3Vic2V0IGFzIGxvb3NlKTtcbiAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBmaWx0ZXJlZFtrZXldID0gdmFsdWU7XG4gICAgICB9XG4gICAgICByZXR1cm4gZmlsdGVyZWQ7XG4gICAgfVxuICB9XG4gIHJldHVybiBhc3NlcnRFcXVhbHMoXG4gICAgLy8gZ2V0IHRoZSBpbnRlcnNlY3Rpb24gb2YgXCJhY3R1YWxcIiBhbmQgXCJleHBlY3RlZFwiXG4gICAgLy8gc2lkZSBlZmZlY3Q6IGFsbCB0aGUgaW5zdGFuY2VzJyBjb25zdHJ1Y3RvciBmaWVsZCBpcyBcIk9iamVjdFwiIG5vdy5cbiAgICBmaWx0ZXIoYWN0dWFsLCBleHBlY3RlZCksXG4gICAgLy8gc2V0IChuZXN0ZWQpIGluc3RhbmNlcycgY29uc3RydWN0b3IgZmllbGQgdG8gYmUgXCJPYmplY3RcIiB3aXRob3V0IGNoYW5naW5nIGV4cGVjdGVkIHZhbHVlLlxuICAgIC8vIHNlZSBodHRwczovL2dpdGh1Yi5jb20vZGVub2xhbmQvZGVub19zdGQvcHVsbC8xNDE5XG4gICAgZmlsdGVyKGV4cGVjdGVkLCBleHBlY3RlZCksXG4gICk7XG59XG5cbi8qKlxuICogRm9yY2VmdWxseSB0aHJvd3MgYSBmYWlsZWQgYXNzZXJ0aW9uXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBmYWlsKG1zZz86IHN0cmluZyk6IG5ldmVyIHtcbiAgYXNzZXJ0KGZhbHNlLCBgRmFpbGVkIGFzc2VydGlvbiR7bXNnID8gYDogJHttc2d9YCA6IFwiLlwifWApO1xufVxuXG4vKipcbiAqIE1ha2UgYW4gYXNzZXJ0aW9uIHRoYXQgYGVycm9yYCBpcyBhbiBgRXJyb3JgLlxuICogSWYgbm90IHRoZW4gYW4gZXJyb3Igd2lsbCBiZSB0aHJvd24uXG4gKiBBbiBlcnJvciBjbGFzcyBhbmQgYSBzdHJpbmcgdGhhdCBzaG91bGQgYmUgaW5jbHVkZWQgaW4gdGhlXG4gKiBlcnJvciBtZXNzYWdlIGNhbiBhbHNvIGJlIGFzc2VydGVkLlxuICovXG5leHBvcnQgZnVuY3Rpb24gYXNzZXJ0SXNFcnJvcjxFIGV4dGVuZHMgRXJyb3IgPSBFcnJvcj4oXG4gIGVycm9yOiB1bmtub3duLFxuICAvLyBkZW5vLWxpbnQtaWdub3JlIG5vLWV4cGxpY2l0LWFueVxuICBFcnJvckNsYXNzPzogbmV3ICguLi5hcmdzOiBhbnlbXSkgPT4gRSxcbiAgbXNnSW5jbHVkZXM/OiBzdHJpbmcsXG4gIG1zZz86IHN0cmluZyxcbik6IGFzc2VydHMgZXJyb3IgaXMgRSB7XG4gIGlmIChlcnJvciBpbnN0YW5jZW9mIEVycm9yID09PSBmYWxzZSkge1xuICAgIHRocm93IG5ldyBBc3NlcnRpb25FcnJvcihgRXhwZWN0ZWQgXCJlcnJvclwiIHRvIGJlIGFuIEVycm9yIG9iamVjdC5gKTtcbiAgfVxuICBpZiAoRXJyb3JDbGFzcyAmJiAhKGVycm9yIGluc3RhbmNlb2YgRXJyb3JDbGFzcykpIHtcbiAgICBtc2cgPSBgRXhwZWN0ZWQgZXJyb3IgdG8gYmUgaW5zdGFuY2Ugb2YgXCIke0Vycm9yQ2xhc3MubmFtZX1cIiwgYnV0IHdhcyBcIiR7XG4gICAgICB0eXBlb2YgZXJyb3IgPT09IFwib2JqZWN0XCIgPyBlcnJvcj8uY29uc3RydWN0b3I/Lm5hbWUgOiBcIltub3QgYW4gb2JqZWN0XVwiXG4gICAgfVwiJHttc2cgPyBgOiAke21zZ31gIDogXCIuXCJ9YDtcbiAgICB0aHJvdyBuZXcgQXNzZXJ0aW9uRXJyb3IobXNnKTtcbiAgfVxuICBpZiAoXG4gICAgbXNnSW5jbHVkZXMgJiYgKCEoZXJyb3IgaW5zdGFuY2VvZiBFcnJvcikgfHxcbiAgICAgICFzdHJpcENvbG9yKGVycm9yLm1lc3NhZ2UpLmluY2x1ZGVzKHN0cmlwQ29sb3IobXNnSW5jbHVkZXMpKSlcbiAgKSB7XG4gICAgbXNnID0gYEV4cGVjdGVkIGVycm9yIG1lc3NhZ2UgdG8gaW5jbHVkZSBcIiR7bXNnSW5jbHVkZXN9XCIsIGJ1dCBnb3QgXCIke1xuICAgICAgZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBcIltub3QgYW4gRXJyb3JdXCJcbiAgICB9XCIke21zZyA/IGA6ICR7bXNnfWAgOiBcIi5cIn1gO1xuICAgIHRocm93IG5ldyBBc3NlcnRpb25FcnJvcihtc2cpO1xuICB9XG59XG5cbi8qKlxuICogRXhlY3V0ZXMgYSBmdW5jdGlvbiwgZXhwZWN0aW5nIGl0IHRvIHRocm93LiAgSWYgaXQgZG9lcyBub3QsIHRoZW4gaXRcbiAqIHRocm93cy4gQW4gZXJyb3IgY2xhc3MgYW5kIGEgc3RyaW5nIHRoYXQgc2hvdWxkIGJlIGluY2x1ZGVkIGluIHRoZVxuICogZXJyb3IgbWVzc2FnZSBjYW4gYWxzbyBiZSBhc3NlcnRlZC4gT3IgeW91IGNhbiBwYXNzIGFcbiAqIGNhbGxiYWNrIHdoaWNoIHdpbGwgYmUgcGFzc2VkIHRoZSBlcnJvciwgdXN1YWxseSB0byBhcHBseSBzb21lIGN1c3RvbVxuICogYXNzZXJ0aW9ucyBvbiBpdC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGFzc2VydFRocm93czxFIGV4dGVuZHMgRXJyb3IgPSBFcnJvcj4oXG4gIGZuOiAoKSA9PiB1bmtub3duLFxuICAvLyBkZW5vLWxpbnQtaWdub3JlIG5vLWV4cGxpY2l0LWFueVxuICBFcnJvckNsYXNzPzogbmV3ICguLi5hcmdzOiBhbnlbXSkgPT4gRSxcbiAgbXNnSW5jbHVkZXM/OiBzdHJpbmcsXG4gIG1zZz86IHN0cmluZyxcbik6IHZvaWQ7XG5leHBvcnQgZnVuY3Rpb24gYXNzZXJ0VGhyb3dzKFxuICBmbjogKCkgPT4gdW5rbm93bixcbiAgZXJyb3JDYWxsYmFjazogKGU6IEVycm9yKSA9PiB1bmtub3duLFxuICBtc2c/OiBzdHJpbmcsXG4pOiB2b2lkO1xuZXhwb3J0IGZ1bmN0aW9uIGFzc2VydFRocm93czxFIGV4dGVuZHMgRXJyb3IgPSBFcnJvcj4oXG4gIGZuOiAoKSA9PiB1bmtub3duLFxuICBlcnJvckNsYXNzT3JDYWxsYmFjaz86XG4gICAgLy8gZGVuby1saW50LWlnbm9yZSBuby1leHBsaWNpdC1hbnlcbiAgICB8IChuZXcgKC4uLmFyZ3M6IGFueVtdKSA9PiBFKVxuICAgIHwgKChlOiBFcnJvcikgPT4gdW5rbm93biksXG4gIG1zZ0luY2x1ZGVzT3JNc2c/OiBzdHJpbmcsXG4gIG1zZz86IHN0cmluZyxcbik6IHZvaWQge1xuICAvLyBkZW5vLWxpbnQtaWdub3JlIG5vLWV4cGxpY2l0LWFueVxuICBsZXQgRXJyb3JDbGFzczogKG5ldyAoLi4uYXJnczogYW55W10pID0+IEUpIHwgdW5kZWZpbmVkID0gdW5kZWZpbmVkO1xuICBsZXQgbXNnSW5jbHVkZXM6IHN0cmluZyB8IHVuZGVmaW5lZCA9IHVuZGVmaW5lZDtcbiAgbGV0IGVycm9yQ2FsbGJhY2s7XG4gIGlmIChcbiAgICBlcnJvckNsYXNzT3JDYWxsYmFjayA9PSBudWxsIHx8XG4gICAgZXJyb3JDbGFzc09yQ2FsbGJhY2sucHJvdG90eXBlIGluc3RhbmNlb2YgRXJyb3IgfHxcbiAgICBlcnJvckNsYXNzT3JDYWxsYmFjay5wcm90b3R5cGUgPT09IEVycm9yLnByb3RvdHlwZVxuICApIHtcbiAgICAvLyBkZW5vLWxpbnQtaWdub3JlIG5vLWV4cGxpY2l0LWFueVxuICAgIEVycm9yQ2xhc3MgPSBlcnJvckNsYXNzT3JDYWxsYmFjayBhcyBuZXcgKC4uLmFyZ3M6IGFueVtdKSA9PiBFO1xuICAgIG1zZ0luY2x1ZGVzID0gbXNnSW5jbHVkZXNPck1zZztcbiAgICBlcnJvckNhbGxiYWNrID0gbnVsbDtcbiAgfSBlbHNlIHtcbiAgICBlcnJvckNhbGxiYWNrID0gZXJyb3JDbGFzc09yQ2FsbGJhY2sgYXMgKGU6IEVycm9yKSA9PiB1bmtub3duO1xuICAgIG1zZyA9IG1zZ0luY2x1ZGVzT3JNc2c7XG4gIH1cbiAgbGV0IGRvZXNUaHJvdyA9IGZhbHNlO1xuICB0cnkge1xuICAgIGZuKCk7XG4gIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgaWYgKGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPT09IGZhbHNlKSB7XG4gICAgICB0aHJvdyBuZXcgQXNzZXJ0aW9uRXJyb3IoXCJBIG5vbi1FcnJvciBvYmplY3Qgd2FzIHRocm93bi5cIik7XG4gICAgfVxuICAgIGFzc2VydElzRXJyb3IoXG4gICAgICBlcnJvcixcbiAgICAgIEVycm9yQ2xhc3MsXG4gICAgICBtc2dJbmNsdWRlcyxcbiAgICAgIG1zZyxcbiAgICApO1xuICAgIGlmICh0eXBlb2YgZXJyb3JDYWxsYmFjayA9PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgIGVycm9yQ2FsbGJhY2soZXJyb3IpO1xuICAgIH1cbiAgICBkb2VzVGhyb3cgPSB0cnVlO1xuICB9XG4gIGlmICghZG9lc1Rocm93KSB7XG4gICAgbXNnID0gYEV4cGVjdGVkIGZ1bmN0aW9uIHRvIHRocm93JHttc2cgPyBgOiAke21zZ31gIDogXCIuXCJ9YDtcbiAgICB0aHJvdyBuZXcgQXNzZXJ0aW9uRXJyb3IobXNnKTtcbiAgfVxufVxuXG4vKipcbiAqIEV4ZWN1dGVzIGEgZnVuY3Rpb24gd2hpY2ggcmV0dXJucyBhIHByb21pc2UsIGV4cGVjdGluZyBpdCB0byB0aHJvdyBvciByZWplY3QuXG4gKiBJZiBpdCBkb2VzIG5vdCwgdGhlbiBpdCB0aHJvd3MuIEFuIGVycm9yIGNsYXNzIGFuZCBhIHN0cmluZyB0aGF0IHNob3VsZCBiZVxuICogaW5jbHVkZWQgaW4gdGhlIGVycm9yIG1lc3NhZ2UgY2FuIGFsc28gYmUgYXNzZXJ0ZWQuIE9yIHlvdSBjYW4gcGFzcyBhXG4gKiBjYWxsYmFjayB3aGljaCB3aWxsIGJlIHBhc3NlZCB0aGUgZXJyb3IsIHVzdWFsbHkgdG8gYXBwbHkgc29tZSBjdXN0b21cbiAqIGFzc2VydGlvbnMgb24gaXQuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBhc3NlcnRSZWplY3RzPEUgZXh0ZW5kcyBFcnJvciA9IEVycm9yPihcbiAgZm46ICgpID0+IFByb21pc2U8dW5rbm93bj4sXG4gIC8vIGRlbm8tbGludC1pZ25vcmUgbm8tZXhwbGljaXQtYW55XG4gIEVycm9yQ2xhc3M/OiBuZXcgKC4uLmFyZ3M6IGFueVtdKSA9PiBFLFxuICBtc2dJbmNsdWRlcz86IHN0cmluZyxcbiAgbXNnPzogc3RyaW5nLFxuKTogUHJvbWlzZTx2b2lkPjtcbmV4cG9ydCBmdW5jdGlvbiBhc3NlcnRSZWplY3RzKFxuICBmbjogKCkgPT4gUHJvbWlzZTx1bmtub3duPixcbiAgZXJyb3JDYWxsYmFjazogKGU6IEVycm9yKSA9PiB1bmtub3duLFxuICBtc2c/OiBzdHJpbmcsXG4pOiBQcm9taXNlPHZvaWQ+O1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGFzc2VydFJlamVjdHM8RSBleHRlbmRzIEVycm9yID0gRXJyb3I+KFxuICBmbjogKCkgPT4gUHJvbWlzZTx1bmtub3duPixcbiAgZXJyb3JDbGFzc09yQ2FsbGJhY2s/OlxuICAgIC8vIGRlbm8tbGludC1pZ25vcmUgbm8tZXhwbGljaXQtYW55XG4gICAgfCAobmV3ICguLi5hcmdzOiBhbnlbXSkgPT4gRSlcbiAgICB8ICgoZTogRXJyb3IpID0+IHVua25vd24pLFxuICBtc2dJbmNsdWRlc09yTXNnPzogc3RyaW5nLFxuICBtc2c/OiBzdHJpbmcsXG4pOiBQcm9taXNlPHZvaWQ+IHtcbiAgLy8gZGVuby1saW50LWlnbm9yZSBuby1leHBsaWNpdC1hbnlcbiAgbGV0IEVycm9yQ2xhc3M6IChuZXcgKC4uLmFyZ3M6IGFueVtdKSA9PiBFKSB8IHVuZGVmaW5lZCA9IHVuZGVmaW5lZDtcbiAgbGV0IG1zZ0luY2x1ZGVzOiBzdHJpbmcgfCB1bmRlZmluZWQgPSB1bmRlZmluZWQ7XG4gIGxldCBlcnJvckNhbGxiYWNrO1xuICBpZiAoXG4gICAgZXJyb3JDbGFzc09yQ2FsbGJhY2sgPT0gbnVsbCB8fFxuICAgIGVycm9yQ2xhc3NPckNhbGxiYWNrLnByb3RvdHlwZSBpbnN0YW5jZW9mIEVycm9yIHx8XG4gICAgZXJyb3JDbGFzc09yQ2FsbGJhY2sucHJvdG90eXBlID09PSBFcnJvci5wcm90b3R5cGVcbiAgKSB7XG4gICAgLy8gZGVuby1saW50LWlnbm9yZSBuby1leHBsaWNpdC1hbnlcbiAgICBFcnJvckNsYXNzID0gZXJyb3JDbGFzc09yQ2FsbGJhY2sgYXMgbmV3ICguLi5hcmdzOiBhbnlbXSkgPT4gRTtcbiAgICBtc2dJbmNsdWRlcyA9IG1zZ0luY2x1ZGVzT3JNc2c7XG4gICAgZXJyb3JDYWxsYmFjayA9IG51bGw7XG4gIH0gZWxzZSB7XG4gICAgZXJyb3JDYWxsYmFjayA9IGVycm9yQ2xhc3NPckNhbGxiYWNrIGFzIChlOiBFcnJvcikgPT4gdW5rbm93bjtcbiAgICBtc2cgPSBtc2dJbmNsdWRlc09yTXNnO1xuICB9XG4gIGxldCBkb2VzVGhyb3cgPSBmYWxzZTtcbiAgdHJ5IHtcbiAgICBhd2FpdCBmbigpO1xuICB9IGNhdGNoIChlcnJvcikge1xuICAgIGlmIChlcnJvciBpbnN0YW5jZW9mIEVycm9yID09PSBmYWxzZSkge1xuICAgICAgdGhyb3cgbmV3IEFzc2VydGlvbkVycm9yKFwiQSBub24tRXJyb3Igb2JqZWN0IHdhcyB0aHJvd24gb3IgcmVqZWN0ZWQuXCIpO1xuICAgIH1cbiAgICBhc3NlcnRJc0Vycm9yKFxuICAgICAgZXJyb3IsXG4gICAgICBFcnJvckNsYXNzLFxuICAgICAgbXNnSW5jbHVkZXMsXG4gICAgICBtc2csXG4gICAgKTtcbiAgICBpZiAodHlwZW9mIGVycm9yQ2FsbGJhY2sgPT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICBlcnJvckNhbGxiYWNrKGVycm9yKTtcbiAgICB9XG4gICAgZG9lc1Rocm93ID0gdHJ1ZTtcbiAgfVxuICBpZiAoIWRvZXNUaHJvdykge1xuICAgIG1zZyA9IGBFeHBlY3RlZCBmdW5jdGlvbiB0byB0aHJvdyR7bXNnID8gYDogJHttc2d9YCA6IFwiLlwifWA7XG4gICAgdGhyb3cgbmV3IEFzc2VydGlvbkVycm9yKG1zZyk7XG4gIH1cbn1cblxuLyoqIFVzZSB0aGlzIHRvIHN0dWIgb3V0IG1ldGhvZHMgdGhhdCB3aWxsIHRocm93IHdoZW4gaW52b2tlZC4gKi9cbmV4cG9ydCBmdW5jdGlvbiB1bmltcGxlbWVudGVkKG1zZz86IHN0cmluZyk6IG5ldmVyIHtcbiAgdGhyb3cgbmV3IEFzc2VydGlvbkVycm9yKG1zZyB8fCBcInVuaW1wbGVtZW50ZWRcIik7XG59XG5cbi8qKiBVc2UgdGhpcyB0byBhc3NlcnQgdW5yZWFjaGFibGUgY29kZS4gKi9cbmV4cG9ydCBmdW5jdGlvbiB1bnJlYWNoYWJsZSgpOiBuZXZlciB7XG4gIHRocm93IG5ldyBBc3NlcnRpb25FcnJvcihcInVucmVhY2hhYmxlXCIpO1xufVxuIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLEVBQTBFLEFBQTFFLHdFQUEwRTtBQUMxRSxFQUE4RSxBQUE5RSw0RUFBOEU7QUFDOUUsRUFBMkMsQUFBM0MseUNBQTJDO0FBRTNDLE1BQU0sR0FBRyxHQUFHLEVBQUUsVUFBVSxRQUFRLENBQWtCO0FBQ2xELE1BQU0sR0FBRyxZQUFZLEVBQUUsSUFBSSxFQUFFLE9BQU8sUUFBUSxDQUFZO0FBQ3hELE1BQU0sR0FBRyxNQUFNLFFBQVEsQ0FBYztBQUVyQyxLQUFLLENBQUMsZUFBZSxHQUFHLENBQWtCO0FBRTFDLE1BQU0sT0FBTyxjQUFjLFNBQVMsS0FBSztJQUM5QixJQUFJLEdBQUcsQ0FBZ0I7Z0JBQ3BCLE9BQWUsQ0FBRSxDQUFDO1FBQzVCLEtBQUssQ0FBQyxPQUFPO0lBQ2YsQ0FBQzs7U0FHTSxpQkFBaUIsQ0FBQyxDQUFVLEVBQXFCLENBQUM7SUFDekQsTUFBTSxDQUFDLENBQUM7UUFBQSxNQUFNLENBQUMsUUFBUTtRQUFFLENBQU07SUFBQSxDQUFDLENBQUMsS0FBSyxFQUFFLENBQUMsR0FBSyxDQUFDLElBQUssQ0FBQzs7QUFDdkQsQ0FBQztBQUVELEVBSUcsQUFKSDs7OztDQUlHLEFBSkgsRUFJRyxDQUNILE1BQU0sVUFBVSxLQUFLLENBQUMsQ0FBVSxFQUFFLENBQVUsRUFBVyxDQUFDO0lBQ3RELEtBQUssQ0FBQyxJQUFJLEdBQUcsR0FBRyxDQUFDLEdBQUc7SUFDcEIsTUFBTSxFQUFFLFFBQVEsQ0FBQyxPQUFPLENBQUMsQ0FBVSxFQUFFLENBQVUsRUFBVyxDQUFDO1FBQ3pELEVBQXFELEFBQXJELG1EQUFxRDtRQUNyRCxFQUFtQyxBQUFuQyxpQ0FBbUM7UUFDbkMsRUFBRSxFQUNBLENBQUMsSUFDRCxDQUFDLEtBQ0MsQ0FBQyxZQUFZLE1BQU0sSUFBSSxDQUFDLFlBQVksTUFBTSxJQUN6QyxDQUFDLFlBQVksR0FBRyxJ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