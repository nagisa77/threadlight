const { readFile, writeFile } = require("node:fs/promises");
const { resolve } = require("node:path");

const { app, BrowserWindow } = require("electron");

const svgPath = resolve(__dirname, "../resources/app-icon.svg");
const pngPath = resolve(__dirname, "../resources/app-icon.png");

app.disableHardwareAcceleration();
app.commandLine.appendSwitch("force-device-scale-factor", "1");

app.whenReady().then(async () => {
  const svg = await readFile(svgPath, "utf8");
  const window = new BrowserWindow({
    width: 1024,
    height: 1024,
    show: false,
    frame: false,
    transparent: true,
    useContentSize: true,
    webPreferences: { offscreen: true },
  });

  const document = `<!doctype html><style>html,body{width:1024px;height:1024px;margin:0;overflow:hidden;background:transparent}svg{display:block}</style>${svg}`;
  await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(document)}`);
  const image = await window.webContents.capturePage();
  const output = image.resize({ width: 1024, height: 1024, quality: "best" });
  await writeFile(pngPath, output.toPNG());

  window.destroy();
  app.quit();
});
