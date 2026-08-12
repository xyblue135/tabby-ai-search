import shutil, os

os.makedirs("pkg/tabby-ai-cmds", exist_ok=True)
files = ["package.json", "dist/index.js", "README_CN.md", "LICENSE",
         "CHANGELOG.md", "INSTALL-Windows.txt"]
for f in files:
    if os.path.exists(f):
        shutil.copy(f, os.path.join("pkg", "tabby-ai-cmds", os.path.basename(f)))
    else:
        print("WARNING: missing", f)
shutil.make_archive("tabby-ai-cmds", "zip", "pkg")
print("packaged tabby-ai-cmds.zip")
