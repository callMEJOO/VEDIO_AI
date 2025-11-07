let file;

document.getElementById("fileInput").addEventListener("change", e => {
    file = e.target.files[0];
    document.getElementById("beforeImg").src = URL.createObjectURL(file);
});

document.getElementById("enhanceBtn").addEventListener("click", async () => {
    if(!file) return alert("اختر ملف");

    const form = new FormData();
    form.append("file", file);
    form.append("model", document.getElementById("modelSelect").value);
    form.append("scale", document.getElementById("scaleSelect").value);

    const progressBar = document.getElementById("bar");
    progressBar.style.width = "10%";

    const res = await fetch("/enhance", { method:"POST", body:form });

    progressBar.style.width = "60%";

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);

    document.getElementById("afterImg").src = url;

    const dl = document.getElementById("downloadBtn");
    dl.href = url;
    dl.style.display = "block";

    progressBar.style.width = "100%";
});
