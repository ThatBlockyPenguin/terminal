export function compose(middleware) {
    return function composedMiddleware(context, next) {
        let index = -1;
        async function dispatch(i) {
            if (i <= index) {
                throw new Error("next() called multiple times.");
            }
            index = i;
            let fn = middleware[i];
            if (i === middleware.length) {
                fn = next;
            }
            if (!fn) {
                return;
            }
            await fn(context, dispatch.bind(null, i + 1));
        }
        return dispatch(0);
    };
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWlkZGxld2FyZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIm1pZGRsZXdhcmUudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBZ0JBLE1BQU0sVUFBVSxPQUFPLENBSXJCLFVBQThCO0lBRTlCLE9BQU8sU0FBUyxrQkFBa0IsQ0FDaEMsT0FBVSxFQUNWLElBQTBCO1FBRTFCLElBQUksS0FBSyxHQUFHLENBQUMsQ0FBQyxDQUFDO1FBRWYsS0FBSyxVQUFVLFFBQVEsQ0FBQyxDQUFTO1lBQy9CLElBQUksQ0FBQyxJQUFJLEtBQUssRUFBRTtnQkFDZCxNQUFNLElBQUksS0FBSyxDQUFDLCtCQUErQixDQUFDLENBQUM7YUFDbEQ7WUFDRCxLQUFLLEdBQUcsQ0FBQyxDQUFDO1lBQ1YsSUFBSSxFQUFFLEdBQWlDLFVBQVUsQ0FBQyxDQUFDLENBQUMsQ0FBQztZQUNyRCxJQUFJLENBQUMsS0FBSyxVQUFVLENBQUMsTUFBTSxFQUFFO2dCQUMzQixFQUFFLEdBQUcsSUFBSSxDQUFDO2FBQ1g7WUFDRCxJQUFJLENBQUMsRUFBRSxFQUFFO2dCQUNQLE9BQU87YUFDUjtZQUNELE1BQU0sRUFBRSxDQUFDLE9BQU8sRUFBRSxRQUFRLENBQUMsSUFBSSxDQUFDLElBQUksRUFBRSxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQztRQUNoRCxDQUFDO1FBRUQsT0FBTyxRQUFRLENBQUMsQ0FBQyxDQUFDLENBQUM7SUFDckIsQ0FBQyxDQUFDO0FBQ0osQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8vIENvcHlyaWdodCAyMDE4LTIwMjAgdGhlIG9hayBhdXRob3JzLiBBbGwgcmlnaHRzIHJlc2VydmVkLiBNSVQgbGljZW5zZS5cblxuLy8gZGVuby1saW50LWlnbm9yZS1maWxlXG5cbmltcG9ydCB0eXBlIHsgU3RhdGUgfSBmcm9tIFwiLi9hcHBsaWNhdGlvbi50c1wiO1xuaW1wb3J0IHR5cGUgeyBDb250ZXh0IH0gZnJvbSBcIi4vY29udGV4dC50c1wiO1xuXG4vKiogTWlkZGxld2FyZSBhcmUgZnVuY3Rpb25zIHdoaWNoIGFyZSBjaGFpbmVkIHRvZ2V0aGVyIHRvIGRlYWwgd2l0aCByZXF1ZXN0cy4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgTWlkZGxld2FyZTxcbiAgUyBleHRlbmRzIFN0YXRlID0gUmVjb3JkPHN0cmluZywgYW55PixcbiAgVCBleHRlbmRzIENvbnRleHQgPSBDb250ZXh0PFM+LFxuPiB7XG4gIChjb250ZXh0OiBULCBuZXh0OiAoKSA9PiBQcm9taXNlPHZvaWQ+KTogUHJvbWlzZTx2b2lkPiB8IHZvaWQ7XG59XG5cbi8qKiBDb21wb3NlIG11bHRpcGxlIG1pZGRsZXdhcmUgZnVuY3Rpb25zIGludG8gYSBzaW5nbGUgbWlkZGxld2FyZSBmdW5jdGlvbi4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjb21wb3NlPFxuICBTIGV4dGVuZHMgU3RhdGUgPSBSZWNvcmQ8c3RyaW5nLCBhbnk+LFxuICBUIGV4dGVuZHMgQ29udGV4dCA9IENvbnRleHQ8Uz4sXG4+KFxuICBtaWRkbGV3YXJlOiBNaWRkbGV3YXJlPFMsIFQ+W10sXG4pOiAoY29udGV4dDogVCwgbmV4dD86ICgpID0+IFByb21pc2U8dm9pZD4pID0+IFByb21pc2U8dm9pZD4ge1xuICByZXR1cm4gZnVuY3Rpb24gY29tcG9zZWRNaWRkbGV3YXJlKFxuICAgIGNvbnRleHQ6IFQsXG4gICAgbmV4dD86ICgpID0+IFByb21pc2U8dm9pZD4sXG4gICk6IFByb21pc2U8dm9pZD4ge1xuICAgIGxldCBpbmRleCA9IC0xO1xuXG4gICAgYXN5bmMgZnVuY3Rpb24gZGlzcGF0Y2goaTogbnVtYmVyKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgICBpZiAoaSA8PSBpbmRleCkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJuZXh0KCkgY2FsbGVkIG11bHRpcGxlIHRpbWVzLlwiKTtcbiAgICAgIH1cbiAgICAgIGluZGV4ID0gaTtcbiAgICAgIGxldCBmbjogTWlkZGxld2FyZTxTLCBUPiB8IHVuZGVmaW5lZCA9IG1pZGRsZXdhcmVbaV07XG4gICAgICBpZiAoaSA9PT0gbWlkZGxld2FyZS5sZW5ndGgpIHtcbiAgICAgICAgZm4gPSBuZXh0O1xuICAgICAgfVxuICAgICAgaWYgKCFmbikge1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICBhd2FpdCBmbihjb250ZXh0LCBkaXNwYXRjaC5iaW5kKG51bGwsIGkgKyAxKSk7XG4gICAgfVxuXG4gICAgcmV0dXJuIGRpc3BhdGNoKDApO1xuICB9O1xufVxuIl19