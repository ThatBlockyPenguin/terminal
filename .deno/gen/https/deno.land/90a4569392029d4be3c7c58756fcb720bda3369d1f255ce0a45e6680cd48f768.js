import { assert } from "./deps.ts";
import { httpErrors } from "./httpError.ts";
import { isMediaType } from "./isMediaType.ts";
import { FormDataReader } from "./multipart.ts";
const defaultBodyContentTypes = {
    json: ["json", "application/*+json", "application/csp-report"],
    form: ["urlencoded"],
    formData: ["multipart"],
    text: ["text"],
};
const decoder = new TextDecoder();
export class RequestBody {
    #body;
    #formDataReader;
    #has;
    #headers;
    #readAllBody;
    #type;
    #valuePromise = () => {
        return this.#readAllBody ?? (this.#readAllBody = Deno.readAll(this.#body));
    };
    constructor(request) {
        const { body, headers } = request;
        this.#body = body;
        this.#headers = headers;
    }
    get({ type, contentTypes }) {
        if (type === "reader" && this.#type && this.#type !== "reader") {
            throw new TypeError("Body already consumed and cannot be returned as a reader.");
        }
        if (type === "form-data" && this.#type && this.#type !== "form-data") {
            throw new TypeError("Body already consumed and cannot be returned as form data.");
        }
        if (this.#type === "reader" && type !== "reader") {
            throw new TypeError("Body already consumed as a reader and can only be returned as a reader.");
        }
        if (this.#type === "form-data" && type !== "form-data") {
            throw new TypeError("Body already consumed as form data and can only be returned as form data.");
        }
        if (type && contentTypes) {
            throw new TypeError(`"type" and "contentTypes" cannot be specified at the same time`);
        }
        if (type === "reader") {
            this.#type = "reader";
            return { type, value: this.#body };
        }
        if (!this.has()) {
            this.#type = "undefined";
        }
        else if (!this.#type) {
            const encoding = this.#headers.get("content-encoding") ?? "identity";
            if (encoding !== "identity") {
                throw new httpErrors.UnsupportedMediaType(`Unsupported content-encoding: ${encoding}`);
            }
        }
        if (this.#type === "undefined") {
            if (type) {
                throw new TypeError(`Body is undefined and cannot be returned as "${type}".`);
            }
            return { type: "undefined", value: undefined };
        }
        if (!type) {
            const contentType = this.#headers.get("content-type");
            assert(contentType);
            contentTypes = contentTypes ?? {};
            const contentTypesJson = [
                ...defaultBodyContentTypes.json,
                ...(contentTypes.json ?? []),
            ];
            const contentTypesForm = [
                ...defaultBodyContentTypes.form,
                ...(contentTypes.form ?? []),
            ];
            const contentTypesFormData = [
                ...defaultBodyContentTypes.formData,
                ...(contentTypes.formData ?? []),
            ];
            const contentTypesText = [
                ...defaultBodyContentTypes.text,
                ...(contentTypes.text ?? []),
            ];
            if (contentTypes.raw && isMediaType(contentType, contentTypes.raw)) {
                type = "raw";
            }
            else if (isMediaType(contentType, contentTypesJson)) {
                type = "json";
            }
            else if (isMediaType(contentType, contentTypesForm)) {
                type = "form";
            }
            else if (isMediaType(contentType, contentTypesFormData)) {
                type = "form-data";
            }
            else if (isMediaType(contentType, contentTypesText)) {
                type = "text";
            }
            else {
                type = "raw";
            }
        }
        assert(type);
        let value;
        switch (type) {
            case "form":
                this.#type = "raw";
                value = async () => new URLSearchParams(decoder.decode(await this.#valuePromise()).replace(/\+/g, " "));
                break;
            case "form-data":
                this.#type = "form-data";
                value = () => {
                    const contentType = this.#headers.get("content-type");
                    assert(contentType);
                    return this.#formDataReader ??
                        (this.#formDataReader = new FormDataReader(contentType, this.#body));
                };
                break;
            case "json":
                this.#type = "raw";
                value = async () => JSON.parse(decoder.decode(await this.#valuePromise()));
                break;
            case "raw":
                this.#type = "raw";
                value = () => this.#valuePromise();
                break;
            case "text":
                this.#type = "raw";
                value = async () => decoder.decode(await this.#valuePromise());
                break;
            default:
                throw new TypeError(`Invalid body type: "${type}"`);
        }
        return {
            type,
            get value() {
                return value();
            },
        };
    }
    has() {
        return this.#has !== undefined
            ? this.#has
            : (this.#has = this.#headers.get("transfer-encoding") !== null ||
                !!parseInt(this.#headers.get("content-length") ?? "", 10));
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYm9keS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbImJvZHkudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBRUEsT0FBTyxFQUFFLE1BQU0sRUFBRSxNQUFNLFdBQVcsQ0FBQztBQUNuQyxPQUFPLEVBQUUsVUFBVSxFQUFFLE1BQU0sZ0JBQWdCLENBQUM7QUFDNUMsT0FBTyxFQUFFLFdBQVcsRUFBRSxNQUFNLGtCQUFrQixDQUFDO0FBQy9DLE9BQU8sRUFBRSxjQUFjLEVBQUUsTUFBTSxnQkFBZ0IsQ0FBQztBQStEaEQsTUFBTSx1QkFBdUIsR0FBRztJQUM5QixJQUFJLEVBQUUsQ0FBQyxNQUFNLEVBQUUsb0JBQW9CLEVBQUUsd0JBQXdCLENBQUM7SUFDOUQsSUFBSSxFQUFFLENBQUMsWUFBWSxDQUFDO0lBQ3BCLFFBQVEsRUFBRSxDQUFDLFdBQVcsQ0FBQztJQUN2QixJQUFJLEVBQUUsQ0FBQyxNQUFNLENBQUM7Q0FDZixDQUFDO0FBRUYsTUFBTSxPQUFPLEdBQUcsSUFBSSxXQUFXLEVBQUUsQ0FBQztBQUVsQyxNQUFNLE9BQU8sV0FBVztJQUN0QixLQUFLLENBQWM7SUFDbkIsZUFBZSxDQUFrQjtJQUNqQyxJQUFJLENBQVc7SUFDZixRQUFRLENBQVU7SUFDbEIsWUFBWSxDQUF1QjtJQUNuQyxLQUFLLENBQWdEO0lBRXJELGFBQWEsR0FBRyxHQUFHLEVBQUU7UUFDbkIsT0FBTyxJQUFJLENBQUMsWUFBWSxJQUFJLENBQUMsSUFBSSxDQUFDLFlBQVksR0FBRyxJQUFJLENBQUMsT0FBTyxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDO0lBQzdFLENBQUMsQ0FBQztJQUVGLFlBQVksT0FBc0I7UUFDaEMsTUFBTSxFQUFFLElBQUksRUFBRSxPQUFPLEVBQUUsR0FBRyxPQUFPLENBQUM7UUFDbEMsSUFBSSxDQUFDLEtBQUssR0FBRyxJQUFJLENBQUM7UUFDbEIsSUFBSSxDQUFDLFFBQVEsR0FBRyxPQUFPLENBQUM7SUFDMUIsQ0FBQztJ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SSxDQUFDLElBQUksR0FBRyxJQUFJLENBQUMsUUFBUSxDQUFDLEdBQUcsQ0FBQyxtQkFBbUIsQ0FBQyxLQUFLLElBQUk7Z0JBQzVELENBQUMsQ0FBQyxRQUFRLENBQUMsSUFBSSxDQUFDLFFBQVEsQ0FBQyxHQUFHLENBQUMsZ0JBQWdCLENBQUMsSUFBSSxFQUFFLEVBQUUsRUFBRSxDQUFDLENBQUMsQ0FBQztJQUNqRSxDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBDb3B5cmlnaHQgMjAxOC0yMDIwIHRoZSBvYWsgYXV0aG9ycy4gQWxsIHJpZ2h0cyByZXNlcnZlZC4gTUlUIGxpY2Vuc2UuXG5cbmltcG9ydCB7IGFzc2VydCB9IGZyb20gXCIuL2RlcHMudHNcIjtcbmltcG9ydCB7IGh0dHBFcnJvcnMgfSBmcm9tIFwiLi9odHRwRXJyb3IudHNcIjtcbmltcG9ydCB7IGlzTWVkaWFUeXBlIH0gZnJvbSBcIi4vaXNNZWRpYVR5cGUudHNcIjtcbmltcG9ydCB7IEZvcm1EYXRhUmVhZGVyIH0gZnJvbSBcIi4vbXVsdGlwYXJ0LnRzXCI7XG5pbXBvcnQgdHlwZSB7IFNlcnZlclJlcXVlc3QgfSBmcm9tIFwiLi90eXBlcy5kLnRzXCI7XG5cbmV4cG9ydCB0eXBlIEJvZHlUeXBlID1cbiAgfCBcImZvcm1cIlxuICB8IFwiZm9ybS1kYXRhXCJcbiAgfCBcImpzb25cIlxuICB8IFwidGV4dFwiXG4gIHwgXCJyYXdcIlxuICB8IFwicmVhZGVyXCJcbiAgfCBcInVuZGVmaW5lZFwiO1xuXG4vLyBkZW5vLWxpbnQtaWdub3JlIG5vLWV4cGxpY2l0LWFueVxuZXhwb3J0IHR5cGUgQm9keUpzb24gPSB7IHR5cGU6IFwianNvblwiOyByZWFkb25seSB2YWx1ZTogUHJvbWlzZTxhbnk+IH07XG5leHBvcnQgdHlwZSBCb2R5Rm9ybSA9IHtcbiAgdHlwZTogXCJmb3JtXCI7XG4gIHJlYWRvbmx5IHZhbHVlOiBQcm9taXNlPFVSTFNlYXJjaFBhcmFtcz47XG59O1xuZXhwb3J0IHR5cGUgQm9keUZvcm1EYXRhID0ge1xuICB0eXBlOiBcImZvcm0tZGF0YVwiO1xuICByZWFkb25seSB2YWx1ZTogRm9ybURhdGFSZWFkZXI7XG59O1xuZXhwb3J0IHR5cGUgQm9keVRleHQgPSB7IHR5cGU6IFwidGV4dFwiOyByZWFkb25seSB2YWx1ZTogUHJvbWlzZTxzdHJpbmc+IH07XG5leHBvcnQgdHlwZSBCb2R5UmF3ID0geyB0eXBlOiBcInJhd1wiOyByZWFkb25seSB2YWx1ZTogUHJvbWlzZTxVaW50OEFycmF5PiB9O1xuZXhwb3J0IHR5cGUgQm9keVVuZGVmaW5lZCA9IHsgdHlwZTogXCJ1bmRlZmluZWRcIjsgcmVhZG9ubHkgdmFsdWU6IHVuZGVmaW5lZCB9O1xuXG5leHBvcnQgdHlwZSBCb2R5UmVhZGVyID0geyB0eXBlOiBcInJlYWRlclwiOyByZWFkb25seSB2YWx1ZTogRGVuby5SZWFkZXIgfTtcblxuZXhwb3J0IHR5cGUgQm9keSA9XG4gIHwgQm9keUpzb25cbiAgfCBCb2R5Rm9ybVxuICB8IEJvZHlGb3JtRGF0YVxuICB8IEJvZHlUZXh0XG4gIHwgQm9keVJhd1xuICB8IEJvZHlVbmRlZmluZWQ7XG5cbmV4cG9ydCBpbnRlcmZhY2UgQm9keU9wdGlvbnM8VCBleHRlbmRzIEJvZHlUeXBlID0gQm9keVR5cGU+IHtcbiAgLyoqIEluc3RlYWQgb2YgdXRpbGl6aW5nIHRoZSBjb250ZW50IHR5cGUgb2YgdGhlIHJlcXVlc3QsIHJldHVybiB0aGUgYm9keVxuICAgKiBhcyB0aGUgdHlwZSBzcGVjaWZpZWQuICovXG4gIHR5cGU/OiBUO1xuICAvKiogQSBtYXAgb2YgZXh0cmEgY29udGVudCB0eXBlcyB0byBkZXRlcm1pbmUgaG93IHRvIHBhcnNlIHRoZSBib2R5LiAqL1xuICBjb250ZW50VHlwZXM/OiB7XG4gICAgLyoqIENvbnRlbnQgdHlwZXMgbGlzdGVkIGhlcmUgd2lsbCBhbHdheXMgcmV0dXJuIGEgXCJyYXdcIiBVaW50OEFycmF5LiAqL1xuICAgIHJhdz86IHN0cmluZ1tdO1xuICAgIC8qKiBDb250ZW50IHR5cGVzIGxpc3RlZCBoZXJlIHdpbGwgYmUgcGFyc2VkIGFzIGEgSlNPTiBzdHJpbmcuICovXG4gICAganNvbj86IHN0cmluZ1tdO1xuICAgIC8qKiBDb250ZW50IHR5cGVzIGxpc3RlZCBoZXJlIHdpbGwgYmUgcGFyc2VkIGFzIGZvcm0gZGF0YSBhbmQgcmV0dXJuXG4gICAgICAgKiBgVVJMU2VhcmNoUGFyYW1ldGVyc2AgYXMgdGhlIHZhbHVlIG9mIHRoZSBib2R5LiAqL1xuICAgIGZvcm0/OiBzdHJpbmdbXTtcbiAgICAvKiogQ29udGVudCB0eXBlcyBsaXN0ZWQgaGVyZSB3aWxsIGJlIHBhcnNlZCBhcyBmcm9tIGRhdGEgYW5kIHJldHVybiBhXG4gICAgICAgKiBgRm9ybURhdGFCb2R5YCBpbnRlcmZhY2UgYXMgdGhlIHZhbHVlIG9mIHRoZSBib2R5LiAqL1xuICAgIGZvcm1EYXRhPzogc3RyaW5nW107XG4gICAgLyoqIENvbnRlbnQgdHlwZXMgbGlzdGVkIGhlcmUgd2lsbCBiZSBwYXJzZWQgYXMgdGV4dC4gKi9cbiAgICB0ZXh0Pzogc3RyaW5nW107XG4gIH07XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgQm9keUNvbnRlbnRUeXBlcyB7XG4gIGpzb24/OiBzdHJpbmdbXTtcbiAgZm9ybT86IHN0cmluZ1tdO1xuICB0ZXh0Pzogc3RyaW5nW107XG59XG5cbmNvbnN0IGRlZmF1bHRCb2R5Q29udGVudFR5cGVzID0ge1xuICBqc29uOiBbXCJqc29uXCIsIFwiYXBwbGljYXRpb24vKitqc29uXCIsIFwiYXBwbGljYXRpb24vY3NwLXJlcG9ydFwiXSxcbiAgZm9ybTogW1widXJsZW5jb2RlZFwiXSxcbiAgZm9ybURhdGE6IFtcIm11bHRpcGFydFwiXSxcbiAgdGV4dDogW1widGV4dFwiXSxcbn07XG5cbmNvbnN0IGRlY29kZXIgPSBuZXcgVGV4dERlY29kZXIoKTtcblxuZXhwb3J0IGNsYXNzIFJlcXVlc3RCb2R5IHtcbiAgI2JvZHk6IERlbm8uUmVhZGVyO1xuICAjZm9ybURhdGFSZWFkZXI/OiBGb3JtRGF0YVJlYWRlcjtcbiAgI2hhcz86IGJvb2xlYW47XG4gICNoZWFkZXJzOiBIZWFkZXJzO1xuICAjcmVhZEFsbEJvZHk/OiBQcm9taXNlPFVpbnQ4QXJyYXk+O1xuICAjdHlwZT86IFwiZm9ybS1kYXRhXCIgfCBcInJhd1wiIHwgXCJyZWFkZXJcIiB8IFwidW5kZWZpbmVkXCI7XG5cbiAgI3ZhbHVlUHJvbWlzZSA9ICgpID0+IHtcbiAgICByZXR1cm4gdGhpcy4jcmVhZEFsbEJvZHkgPz8gKHRoaXMuI3JlYWRBbGxCb2R5ID0gRGVuby5yZWFkQWxsKHRoaXMuI2JvZHkpKTtcbiAgfTtcblxuICBjb25zdHJ1Y3RvcihyZXF1ZXN0OiBTZXJ2ZXJSZXF1ZXN0KSB7XG4gICAgY29uc3QgeyBib2R5LCBoZWFkZXJzIH0gPSByZXF1ZXN0O1xuICAgIHRoaXMuI2JvZHkgPSBib2R5O1xuICAgIHRoaXMuI2hlYWRlcnMgPSBoZWFkZXJzO1xuICB9XG5cbiAgZ2V0KHsgdHlwZSwgY29udGVudFR5cGVzIH06IEJvZHlPcHRpb25zKTogQm9keSB8IEJvZHlSZWFkZXIge1xuICAgIGlmICh0eXBlID09PSBcInJlYWRlclwiICYmIHRoaXMuI3R5cGUgJiYgdGhpcy4jdHlwZSAhPT0gXCJyZWFkZXJcIikge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcihcbiAgICAgICAgXCJCb2R5IGFscmVhZHkgY29uc3VtZWQgYW5kIGNhbm5vdCBiZSByZXR1cm5lZCBhcyBhIHJlYWRlci5cIixcbiAgICAgICk7XG4gICAgfVxuICAgIGlmICh0eXBlID09PSBcImZvcm0tZGF0YVwiICYmIHRoaXMuI3R5cGUgJiYgdGhpcy4jdHlwZSAhPT0gXCJmb3JtLWRhdGFcIikge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcihcbiAgICAgICAgXCJCb2R5IGFscmVhZHkgY29uc3VtZWQgYW5kIGNhbm5vdCBiZSByZXR1cm5lZCBhcyBmb3JtIGRhdGEuXCIsXG4gICAgICApO1xuICAgIH1cbiAgICBpZiAodGhpcy4jdHlwZSA9PT0gXCJyZWFkZXJcIiAmJiB0eXBlICE9PSBcInJlYWRlclwiKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKFxuICAgICAgICBcIkJvZHkgYWxyZWFkeSBjb25zdW1lZCBhcyBhIHJlYWRlciBhbmQgY2FuIG9ubHkgYmUgcmV0dXJuZWQgYXMgYSByZWFkZXIuXCIsXG4gICAgICApO1xuICAgIH1cbiAgICBpZiAodGhpcy4jdHlwZSA9PT0gXCJmb3JtLWRhdGFcIiAmJiB0eXBlICE9PSBcImZvcm0tZGF0YVwiKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKFxuICAgICAgICBcIkJvZHkgYWxyZWFkeSBjb25zdW1lZCBhcyBmb3JtIGRhdGEgYW5kIGNhbiBvbmx5IGJlIHJldHVybmVkIGFzIGZvcm0gZGF0YS5cIixcbiAgICAgICk7XG4gICAgfVxuICAgIGlmICh0eXBlICYmIGNvbnRlbnRUeXBlcykge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcihcbiAgICAgICAgYFwidHlwZVwiIGFuZCBcImNvbnRlbnRUeXBlc1wiIGNhbm5vdCBiZSBzcGVjaWZpZWQgYXQgdGhlIHNhbWUgdGltZWAsXG4gICAgICApO1xuICAgIH1cbiAgICBpZiAodHlwZSA9PT0gXCJyZWFkZXJcIikge1xuICAgICAgdGhpcy4jdHlwZSA9IFwicmVhZGVyXCI7XG4gICAgICByZXR1cm4geyB0eXBlLCB2YWx1ZTogdGhpcy4jYm9keSB9O1xuICAgIH1cbiAgICBpZiAoIXRoaXMuaGFzKCkpIHtcbiAgICAgIHRoaXMuI3R5cGUgPSBcInVuZGVmaW5lZFwiO1xuICAgIH0gZWxzZSBpZiAoIXRoaXMuI3R5cGUpIHtcbiAgICAgIGNvbnN0IGVuY29kaW5nID0gdGhpcy4jaGVhZGVycy5nZXQoXCJjb250ZW50LWVuY29kaW5nXCIpID8/IFwiaWRlbnRpdHlcIjtcbiAgICAgIGlmIChlbmNvZGluZyAhPT0gXCJpZGVudGl0eVwiKSB7XG4gICAgICAgIHRocm93IG5ldyBodHRwRXJyb3JzLlVuc3VwcG9ydGVkTWVkaWFUeXBlKFxuICAgICAgICAgIGBVbnN1cHBvcnRlZCBjb250ZW50LWVuY29kaW5nOiAke2VuY29kaW5nfWAsXG4gICAgICAgICk7XG4gICAgICB9XG4gICAgfVxuICAgIGlmICh0aGlzLiN0eXBlID09PSBcInVuZGVmaW5lZFwiKSB7XG4gICAgICBpZiAodHlwZSkge1xuICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKFxuICAgICAgICAgIGBCb2R5IGlzIHVuZGVmaW5lZCBhbmQgY2Fubm90IGJlIHJldHVybmVkIGFzIFwiJHt0eXBlfVwiLmAsXG4gICAgICAgICk7XG4gICAgICB9XG4gICAgICByZXR1cm4geyB0eXBlOiBcInVuZGVmaW5lZFwiLCB2YWx1ZTogdW5kZWZpbmVkIH07XG4gICAgfVxuICAgIGlmICghdHlwZSkge1xuICAgICAgY29uc3QgY29udGVudFR5cGUgPSB0aGlzLiNoZWFkZXJzLmdldChcImNvbnRlbnQtdHlwZVwiKTtcbiAgICAgIGFzc2VydChjb250ZW50VHlwZSk7XG4gICAgICBjb250ZW50VHlwZXMgPSBjb250ZW50VHlwZXMgPz8ge307XG4gICAgICBjb25zdCBjb250ZW50VHlwZXNKc29uID0gW1xuICAgICAgICAuLi5kZWZhdWx0Qm9keUNvbnRlbnRUeXBlcy5qc29uLFxuICAgICAgICAuLi4oY29udGVudFR5cGVzLmpzb24gPz8gW10pLFxuICAgICAgXTtcbiAgICAgIGNvbnN0IGNvbnRlbnRUeXBlc0Zvcm0gPSBbXG4gICAgICAgIC4uLmRlZmF1bHRCb2R5Q29udGVudFR5cGVzLmZvcm0sXG4gICAgICAgIC4uLihjb250ZW50VHlwZXMuZm9ybSA/PyBbXSksXG4gICAgICBdO1xuICAgICAgY29uc3QgY29udGVudFR5cGVzRm9ybURhdGEgPSBbXG4gICAgICAgIC4uLmRlZmF1bHRCb2R5Q29udGVudFR5cGVzLmZvcm1EYXRhLFxuICAgICAgICAuLi4oY29udGVudFR5cGVzLmZvcm1EYXRhID8/IFtdKSxcbiAgICAgIF07XG4gICAgICBjb25zdCBjb250ZW50VHlwZXNUZXh0ID0gW1xuICAgICAgICAuLi5kZWZhdWx0Qm9keUNvbnRlbnRUeXBlcy50ZXh0LFxuICAgICAgICAuLi4oY29udGVudFR5cGVzLnRleHQgPz8gW10pLFxuICAgICAgXTtcbiAgICAgIGlmIChjb250ZW50VHlwZXMucmF3ICYmIGlzTWVkaWFUeXBlKGNvbnRlbnRUeXBlLCBjb250ZW50VHlwZXMucmF3KSkge1xuICAgICAgICB0eXBlID0gXCJyYXdcIjtcbiAgICAgIH0gZWxzZSBpZiAoaXNNZWRpYVR5cGUoY29udGVudFR5cGUsIGNvbnRlbnRUeXBlc0pzb24pKSB7XG4gICAgICAgIHR5cGUgPSBcImpzb25cIjtcbiAgICAgIH0gZWxzZSBpZiAoaXNNZWRpYVR5cGUoY29udGVudFR5cGUsIGNvbnRlbnRUeXBlc0Zvcm0pKSB7XG4gICAgICAgIHR5cGUgPSBcImZvcm1cIjtcbiAgICAgIH0gZWxzZSBpZiAoaXNNZWRpYVR5cGUoY29udGVudFR5cGUsIGNvbnRlbnRUeXBlc0Zvcm1EYXRhKSkge1xuICAgICAgICB0eXBlID0gXCJmb3JtLWRhdGFcIjtcbiAgICAgIH0gZWxzZSBpZiAoaXNNZWRpYVR5cGUoY29udGVudFR5cGUsIGNvbnRlbnRUeXBlc1RleHQpKSB7XG4gICAgICAgIHR5cGUgPSBcInRleHRcIjtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHR5cGUgPSBcInJhd1wiO1xuICAgICAgfVxuICAgIH1cbiAgICBhc3NlcnQodHlwZSk7XG4gICAgbGV0IHZhbHVlOiAoKSA9PiBCb2R5W1widmFsdWVcIl07XG4gICAgc3dpdGNoICh0eXBlKSB7XG4gICAgICBjYXNlIFwiZm9ybVwiOlxuICAgICAgICB0aGlzLiN0eXBlID0gXCJyYXdcIjtcbiAgICAgICAgdmFsdWUgPSBhc3luYyAoKSA9PlxuICAgICAgICAgIG5ldyBVUkxTZWFyY2hQYXJhbXMoXG4gICAgICAgICAgICBkZWNvZGVyLmRlY29kZShhd2FpdCB0aGlzLiN2YWx1ZVByb21pc2UoKSkucmVwbGFjZSgvXFwrL2csIFwiIFwiKSxcbiAgICAgICAgICApO1xuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgXCJmb3JtLWRhdGFcIjpcbiAgICAgICAgdGhpcy4jdHlwZSA9IFwiZm9ybS1kYXRhXCI7XG4gICAgICAgIHZhbHVlID0gKCkgPT4ge1xuICAgICAgICAgIGNvbnN0IGNvbnRlbnRUeXBlID0gdGhpcy4jaGVhZGVycy5nZXQoXCJjb250ZW50LXR5cGVcIik7XG4gICAgICAgICAgYXNzZXJ0KGNvbnRlbnRUeXBlKTtcbiAgICAgICAgICByZXR1cm4gdGhpcy4jZm9ybURhdGFSZWFkZXIgPz9cbiAgICAgICAgICAgICh0aGlzLiNmb3JtRGF0YVJlYWRlciA9IG5ldyBGb3JtRGF0YVJlYWRlcihcbiAgICAgICAgICAgICAgY29udGVudFR5cGUsXG4gICAgICAgICAgICAgIHRoaXMuI2JvZHksXG4gICAgICAgICAgICApKTtcbiAgICAgICAgfTtcbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlIFwianNvblwiOlxuICAgICAgICB0aGlzLiN0eXBlID0gXCJyYXdcIjtcbiAgICAgICAgdmFsdWUgPSBhc3luYyAoKSA9PlxuICAgICAgICAgIEpTT04ucGFyc2UoZGVjb2Rlci5kZWNvZGUoYXdhaXQgdGhpcy4jdmFsdWVQcm9taXNlKCkpKTtcbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlIFwicmF3XCI6XG4gICAgICAgIHRoaXMuI3R5cGUgPSBcInJhd1wiO1xuICAgICAgICB2YWx1ZSA9ICgpID0+IHRoaXMuI3ZhbHVlUHJvbWlzZSgpO1xuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgXCJ0ZXh0XCI6XG4gICAgICAgIHRoaXMuI3R5cGUgPSBcInJhd1wiO1xuICAgICAgICB2YWx1ZSA9IGFzeW5jICgpID0+IGRlY29kZXIuZGVjb2RlKGF3YWl0IHRoaXMuI3ZhbHVlUHJvbWlzZSgpKTtcbiAgICAgICAgYnJlYWs7XG4gICAgICBkZWZhdWx0OlxuICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKGBJbnZhbGlkIGJvZHkgdHlwZTogXCIke3R5cGV9XCJgKTtcbiAgICB9XG4gICAgcmV0dXJuIHtcbiAgICAgIHR5cGUsXG4gICAgICBnZXQgdmFsdWUoKSB7XG4gICAgICAgIHJldHVybiB2YWx1ZSgpO1xuICAgICAgfSxcbiAgICB9IGFzIEJvZHk7XG4gIH1cblxuICBoYXMoKTogYm9vbGVhbiB7XG4gICAgcmV0dXJuIHRoaXMuI2hhcyAhPT0gdW5kZWZpbmVkXG4gICAgICA/IHRoaXMuI2hhc1xuICAgICAgOiAodGhpcy4jaGFzID0gdGhpcy4jaGVhZGVycy5nZXQoXCJ0cmFuc2Zlci1lbmNvZGluZ1wiKSAhPT0gbnVsbCB8fFxuICAgICAgICAhIXBhcnNlSW50KHRoaXMuI2hlYWRlcnMuZ2V0KFwiY29udGVudC1sZW5ndGhcIikgPz8gXCJcIiwgMTApKTtcbiAgfVxufVxuIl19