// Copyright 2018-2022 the Deno authors. All rights reserved. MIT license.
// This module is browser compatible.
export class DenoStdInternalError extends Error {
    constructor(message){
        super(message);
        this.name = "DenoStdInternalError";
    }
}
/** Make an assertion, if not `true`, then throw. */ export function assert(expr, msg = "") {
    if (!expr) {
        throw new DenoStdInternalError(msg);
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbImh0dHBzOi8vZGVuby5sYW5kL3N0ZEAwLjEzNy4wL191dGlsL2Fzc2VydC50cyJdLCJzb3VyY2VzQ29udGVudCI6WyIvLyBDb3B5cmlnaHQgMjAxOC0yMDIyIHRoZSBEZW5vIGF1dGhvcnMuIEFsbCByaWdodHMgcmVzZXJ2ZWQuIE1JVCBsaWNlbnNlLlxuLy8gVGhpcyBtb2R1bGUgaXMgYnJvd3NlciBjb21wYXRpYmxlLlxuXG5leHBvcnQgY2xhc3MgRGVub1N0ZEludGVybmFsRXJyb3IgZXh0ZW5kcyBFcnJvciB7XG4gIGNvbnN0cnVjdG9yKG1lc3NhZ2U6IHN0cmluZykge1xuICAgIHN1cGVyKG1lc3NhZ2UpO1xuICAgIHRoaXMubmFtZSA9IFwiRGVub1N0ZEludGVybmFsRXJyb3JcIjtcbiAgfVxufVxuXG4vKiogTWFrZSBhbiBhc3NlcnRpb24sIGlmIG5vdCBgdHJ1ZWAsIHRoZW4gdGhyb3cuICovXG5leHBvcnQgZnVuY3Rpb24gYXNzZXJ0KGV4cHI6IHVua25vd24sIG1zZyA9IFwiXCIpOiBhc3NlcnRzIGV4cHIge1xuICBpZiAoIWV4cHIpIHtcbiAgICB0aHJvdyBuZXcgRGVub1N0ZEludGVybmFsRXJyb3IobXNnKTtcbiAgfVxufVxuIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLEVBQTBFLEFBQTFFLHdFQUEwRTtBQUMxRSxFQUFxQyxBQUFyQyxtQ0FBcUM7QUFFckMsTUFBTSxPQUFPLG9CQUFvQixTQUFTLEtBQUs7Z0JBQ2pDLE9BQWUsQ0FBRSxDQUFDO1FBQzVCLEtBQUssQ0FBQyxPQUFPO1FBQ2IsSUFBSSxDQUFDLElBQUksR0FBRyxDQUFzQjtJQUNwQyxDQUFDOztBQUdILEVBQW9ELEFBQXBELGdEQUFvRCxBQUFwRCxFQUFvRCxDQUNwRCxNQUFNLFVBQVUsTUFBTSxDQUFDLElBQWEsRUFBRSxHQUFHLEdBQUcsQ0FBRSxHQUFnQixDQUFDO0lBQzdELEVBQUUsR0FBRyxJQUFJLEVBQUUsQ0FBQztRQUNWLEtBQUssQ0FBQyxHQUFHLENBQUMsb0JBQW9CLENBQUMsR0FBRztJQUNwQyxDQUFDO0FBQ0gsQ0FBQyJ9