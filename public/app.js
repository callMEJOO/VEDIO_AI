let file;

document.getElementById("fileInput").onchange = e => {
  file = e.target.files[0];
  document.getElementById("beforeImg").src = URL.createObjectURL(file);
  document.getElementById("status").innerText = "";
  document.getElementById("afterImg").src = "";
};

document.getElementById("enhanceBtn").onclick = async () => {
  if (!file) return alert("Choose file");

  const model = modelSelect.value;
  const scale = scaleSelect.value;
  const format = formatSelect.value;

  const form = new FormData();
  form.append("file", file);
  form.append("model", model);
  form.append("scale", scale);
  form.append("format", format);

  if (file.type.startsWith("image")) {
    const res = await fetch("/enhance/image", { method: "POST", body: form });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    afterImg.src = url;
    downloadBtn.href = url;
    downloadBtn.style.display = "block";
  } else {
    const res = await fetch("/enhance/video", { method:"POST", body:form });
    const { processId } = await res.json();
    document.getElementById("status").innerText = "Rendering...";
    
    const poll = setInterval(async () => {
      const s = await fetch("/status/" + processId).then(r => r.json());
      document.getElementById("status").innerText = s.status;

      if (s.status === "completed") {
        clearInterval(poll);
        const blob = await fetch(s.output_url).then(r => r.blob());
        const url = URL.createObjectURL(blob);
        afterImg.src = url;
        downloadBtn.href = url;
        downloadBtn.style.display = "block";
      }
    }, 3000);
  }
};
