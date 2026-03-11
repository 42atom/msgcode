## Banana Pro Run Template

默认行为：将用户输入作为 `generate` 的 prompt。

用户输入：
{{input}}

```bash
set -euo pipefail
PROMPT="$(cat <<'EOF'
{{input}}
EOF
)"
bash ~/.config/msgcode/skills/banana-pro-image-gen/main.sh generate --prompt "$PROMPT"
```
