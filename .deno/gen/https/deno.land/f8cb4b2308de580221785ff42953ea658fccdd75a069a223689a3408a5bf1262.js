import { HmacSha256 } from "./deps.ts";
import { compare } from "./tssCompare.ts";
const replacements = {
    "/": "_",
    "+": "-",
    "=": "",
};
export class KeyStack {
    #keys;
    constructor(keys) {
        if (!(0 in keys)) {
            throw new TypeError("keys must contain at least one value");
        }
        this.#keys = keys;
    }
    #sign = (data, key) => {
        return btoa(String.fromCharCode.apply(undefined, new Uint8Array(new HmacSha256(key).update(data).arrayBuffer())))
            .replace(/\/|\+|=/g, (c) => replacements[c]);
    };
    sign(data) {
        return this.#sign(data, this.#keys[0]);
    }
    verify(data, digest) {
        return this.indexOf(data, digest) > -1;
    }
    indexOf(data, digest) {
        for (let i = 0; i < this.#keys.length; i++) {
            if (compare(digest, this.#sign(data, this.#keys[i]))) {
                return i;
            }
        }
        return -1;
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoia2V5U3RhY2suanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJrZXlTdGFjay50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFNQSxPQUFPLEVBQUUsVUFBVSxFQUFFLE1BQU0sV0FBVyxDQUFDO0FBQ3ZDLE9BQU8sRUFBRSxPQUFPLEVBQUUsTUFBTSxpQkFBaUIsQ0FBQztBQUsxQyxNQUFNLFlBQVksR0FBMkI7SUFDM0MsR0FBRyxFQUFFLEdBQUc7SUFDUixHQUFHLEVBQUUsR0FBRztJQUNSLEdBQUcsRUFBRSxFQUFFO0NBQ1IsQ0FBQztBQUVGLE1BQU0sT0FBTyxRQUFRO0lBQ25CLEtBQUssQ0FBUTtJQVNiLFlBQVksSUFBVztRQUNyQixJQUFJLENBQUMsQ0FBQyxDQUFDLElBQUksSUFBSSxDQUFDLEVBQUU7WUFDaEIsTUFBTSxJQUFJLFNBQVMsQ0FBQyxzQ0FBc0MsQ0FBQyxDQUFDO1NBQzdEO1FBQ0QsSUFBSSxDQUFDLEtBQUssR0FBRyxJQUFJLENBQUM7SUFDcEIsQ0FBQztJQUVELEtBQUssR0FBRyxDQUFDLElBQVUsRUFBRSxHQUFRLEVBQVUsRUFBRTtRQUN2QyxPQUFPLElBQUksQ0FDVCxNQUFNLENBQUMsWUFBWSxDQUFDLEtBQUssQ0FDdkIsU0FBUyxFQUVULElBQUksVUFBVSxDQUFDLElBQUksVUFBVSxDQUFDLEdBQUcsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsQ0FBQyxXQUFXLEVBQUUsQ0FBUSxDQUN0RSxDQUNGO2FBQ0UsT0FBTyxDQUFDLFVBQVUsRUFBRSxDQUFDLENBQUMsRUFBRSxFQUFFLENBQUMsWUFBWSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7SUFDakQsQ0FBQyxDQUFDO0lBS0YsSUFBSSxDQUFDLElBQVU7UUFDYixPQUFPLElBQUksQ0FBQyxLQUFLLENBQUMsSUFBSSxFQUFFLElBQUksQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztJQUN6QyxDQUFDO0lBS0QsTUFBTSxDQUFDLElBQVUsRUFBRSxNQUFjO1FBQy9CLE9BQU8sSUFBSSxDQUFDLE9BQU8sQ0FBQyxJQUFJLEVBQUUsTUFBTSxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUM7SUFDekMsQ0FBQztJQUtELE9BQU8sQ0FBQyxJQUFVLEVBQUUsTUFBYztRQUNoQyxLQUFLLElBQUksQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxNQUFNLEVBQUUsQ0FBQyxFQUFFLEVBQUU7WUFDMUMsSUFBSSxPQUFPLENBQUMsTUFBTSxFQUFFLElBQUksQ0FBQyxLQUFLLENBQUMsSUFBSSxFQUFFLElBQUksQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxFQUFFO2dCQUNwRCxPQUFPLENBQUMsQ0FBQzthQUNWO1NBQ0Y7UUFDRCxPQUFPLENBQUMsQ0FBQyxDQUFDO0lBQ1osQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQ29weXJpZ2h0IDIwMTgtMjAyMCB0aGUgb2FrIGF1dGhvcnMuIEFsbCByaWdodHMgcmVzZXJ2ZWQuIE1JVCBsaWNlbnNlLlxuXG4vLyBUaGlzIHdhcyBpbnNwaXJlZCBieSBba2V5Z3JpcF0oaHR0cHM6Ly9naXRodWIuY29tL2NyeXB0by11dGlscy9rZXlncmlwLylcbi8vIHdoaWNoIGFsbG93cyBzaWduaW5nIG9mIGRhdGEgKGNvb2tpZXMpIHRvIHByZXZlbnQgdGFtcGVyaW5nLCBidXQgYWxzbyBhbGxvd3Ncbi8vIGZvciBlYXN5IGtleSByb3RhdGlvbiB3aXRob3V0IG5lZWRpbmcgdG8gcmVzaWduIHRoZSBkYXRhLlxuXG5pbXBvcnQgeyBIbWFjU2hhMjU2IH0gZnJvbSBcIi4vZGVwcy50c1wiO1xuaW1wb3J0IHsgY29tcGFyZSB9IGZyb20gXCIuL3Rzc0NvbXBhcmUudHNcIjtcblxuZXhwb3J0IHR5cGUgRGF0YSA9IHN0cmluZyB8IG51bWJlcltdIHwgQXJyYXlCdWZmZXIgfCBVaW50OEFycmF5O1xuZXhwb3J0IHR5cGUgS2V5ID0gc3RyaW5nIHwgbnVtYmVyW10gfCBBcnJheUJ1ZmZlciB8IFVpbnQ4QXJyYXk7XG5cbmNvbnN0IHJlcGxhY2VtZW50czogUmVjb3JkPHN0cmluZywgc3RyaW5nPiA9IHtcbiAgXCIvXCI6IFwiX1wiLFxuICBcIitcIjogXCItXCIsXG4gIFwiPVwiOiBcIlwiLFxufTtcblxuZXhwb3J0IGNsYXNzIEtleVN0YWNrIHtcbiAgI2tleXM6IEtleVtdO1xuXG4gIC8qKiBBIGNsYXNzIHdoaWNoIGFjY2VwdHMgYW4gYXJyYXkgb2Yga2V5cyB0aGF0IGFyZSB1c2VkIHRvIHNpZ24gYW5kIHZlcmlmeVxuICAgKiBkYXRhIGFuZCBhbGxvd3MgZWFzeSBrZXkgcm90YXRpb24gd2l0aG91dCBpbnZhbGlkYXRpb24gb2YgcHJldmlvdXNseSBzaWduZWRcbiAgICogZGF0YS5cbiAgICogXG4gICAqIEBwYXJhbSBrZXlzIEFuIGFycmF5IG9mIGtleXMsIG9mIHdoaWNoIHRoZSBpbmRleCAwIHdpbGwgYmUgdXNlZCB0byBzaWduXG4gICAqICAgICAgICAgICAgIGRhdGEsIGJ1dCB2ZXJpZmljYXRpb24gY2FuIGhhcHBlbiBhZ2FpbnN0IGFueSBrZXkuXG4gICAqL1xuICBjb25zdHJ1Y3RvcihrZXlzOiBLZXlbXSkge1xuICAgIGlmICghKDAgaW4ga2V5cykpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoXCJrZXlzIG11c3QgY29udGFpbiBhdCBsZWFzdCBvbmUgdmFsdWVcIik7XG4gICAgfVxuICAgIHRoaXMuI2tleXMgPSBrZXlzO1xuICB9XG5cbiAgI3NpZ24gPSAoZGF0YTogRGF0YSwga2V5OiBLZXkpOiBzdHJpbmcgPT4ge1xuICAgIHJldHVybiBidG9hKFxuICAgICAgU3RyaW5nLmZyb21DaGFyQ29kZS5hcHBseShcbiAgICAgICAgdW5kZWZpbmVkLFxuICAgICAgICAvLyBkZW5vLWxpbnQtaWdub3JlIG5vLWV4cGxpY2l0LWFueVxuICAgICAgICBuZXcgVWludDhBcnJheShuZXcgSG1hY1NoYTI1NihrZXkpLnVwZGF0ZShkYXRhKS5hcnJheUJ1ZmZlcigpKSBhcyBhbnksXG4gICAgICApLFxuICAgIClcbiAgICAgIC5yZXBsYWNlKC9cXC98XFwrfD0vZywgKGMpID0+IHJlcGxhY2VtZW50c1tjXSk7XG4gIH07XG5cbiAgLyoqIFRha2UgYGRhdGFgIGFuZCByZXR1cm4gYSBTSEEyNTYgSE1BQyBkaWdlc3QgdGhhdCB1c2VzIHRoZSBjdXJyZW50IDAgaW5kZXhcbiAgICogb2YgdGhlIGBrZXlzYCBwYXNzZWQgdG8gdGhlIGNvbnN0cnVjdG9yLiAgVGhpcyBkaWdlc3QgaXMgaW4gdGhlIGZvcm0gb2YgYVxuICAgKiBVUkwgc2FmZSBiYXNlNjQgZW5jb2RlZCBzdHJpbmcuICovXG4gIHNpZ24oZGF0YTogRGF0YSk6IHN0cmluZyB7XG4gICAgcmV0dXJuIHRoaXMuI3NpZ24oZGF0YSwgdGhpcy4ja2V5c1swXSk7XG4gIH1cblxuICAvKiogR2l2ZW4gYGRhdGFgIGFuZCBhIGBkaWdlc3RgLCB2ZXJpZnkgdGhhdCBvbmUgb2YgdGhlIGBrZXlzYCBwcm92aWRlZCB0aGVcbiAgICogY29uc3RydWN0b3Igd2FzIHVzZWQgdG8gZ2VuZXJhdGUgdGhlIGBkaWdlc3RgLiAgUmV0dXJucyBgdHJ1ZWAgaWYgb25lIG9mXG4gICAqIHRoZSBrZXlzIHdhcyB1c2VkLCBvdGhlcndpc2UgYGZhbHNlYC4gKi9cbiAgdmVyaWZ5KGRhdGE6IERhdGEsIGRpZ2VzdDogc3RyaW5nKTogYm9vbGVhbiB7XG4gICAgcmV0dXJuIHRoaXMuaW5kZXhPZihkYXRhLCBkaWdlc3QpID4gLTE7XG4gIH1cblxuICAvKiogR2l2ZW4gYGRhdGFgIGFuZCBhIGBkaWdlc3RgLCByZXR1cm4gdGhlIGN1cnJlbnQgaW5kZXggb2YgdGhlIGtleSBpbiB0aGVcbiAgICogYGtleXNgIHBhc3NlZCB0aGUgY29uc3RydWN0b3IgdGhhdCB3YXMgdXNlZCB0byBnZW5lcmF0ZSB0aGUgZGlnZXN0LiAgSWYgbm9cbiAgICoga2V5IGNhbiBiZSBmb3VuZCwgdGhlIG1ldGhvZCByZXR1cm5zIGAtMWAuICovXG4gIGluZGV4T2YoZGF0YTogRGF0YSwgZGlnZXN0OiBzdHJpbmcpOiBudW1iZXIge1xuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgdGhpcy4ja2V5cy5sZW5ndGg7IGkrKykge1xuICAgICAgaWYgKGNvbXBhcmUoZGlnZXN0LCB0aGlzLiNzaWduKGRhdGEsIHRoaXMuI2tleXNbaV0pKSkge1xuICAgICAgICByZXR1cm4gaTtcbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIC0xO1xuICB9XG59XG4iXX0=