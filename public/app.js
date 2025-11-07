let file;

document.getElementById("fileInput").addEventListener("change", e => {
    file = e.target.files[0];
    document.getElementById("beforeImg").src = URL.createObjectURL(file);
});

document.getElementById("enhanceBtn").addEventListener("click", async () => {
    if (!file) return alert("Choose file first!");

    const form = new FormData();
    form.append("file", file);

    const res = await fetch("/enhance", {
        method: "POST",
        body: form
    });

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);

    document.getElementById("afterImg").src = url;

    const dl = document.getElementById("downloadBtn");
    dl.href = url;
    dl.download = "enhanced.jpg";
    dl.style.display = "block";
});
