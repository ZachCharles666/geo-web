import "https://cdn.jsdelivr.net/npm/preline@1.9.0/+esm";

window.addEventListener("load", () => {
  if (window.HSStaticMethods && typeof window.HSStaticMethods.autoInit === "function") {
    window.HSStaticMethods.autoInit();
  }
});
