from pathlib import Path
import subprocess

path = Path('.github/agent-table-qr-patch.py')
text = path.read_text(encoding='utf-8')

marker = '''def replace_once(path: str, old: str, new: str) -> None:\n    text = read(path)\n    count = text.count(old)\n    if count != 1:\n        raise SystemExit(f"{path}: expected exactly one match, found {count}\\n--- needle ---\\n{old[:700]}")\n    write(path, text.replace(old, new, 1))\n'''
replacement = marker + '''\n\ndef replace_last(path: str, old: str, new: str, expected_count: int = 2) -> None:\n    text = read(path)\n    count = text.count(old)\n    if count != expected_count:\n        raise SystemExit(f"{path}: expected {expected_count} matches before last-only replacement, found {count}\\n--- needle ---\\n{old[:700]}")\n    head, tail = text.rsplit(old, 1)\n    write(path, head + new + tail)\n'''
if marker not in text:
    raise SystemExit('replace_once helper marker not found')
text = text.replace(marker, replacement, 1)

old_call = '''replace_once(\n    catalog_path,\n    \'\'\'      const useIngredientRecipe = Boolean(body.use_ingredient_recipe);\n      const ingredientLines = Array.isArray(body.ingredient_lines) ? body.ingredient_lines : [];\'\'\',\n    \'\'\'      const useIngredientRecipe = Boolean(body.use_ingredient_recipe);\n      const customerIngredientSelectionEnabled =\n        useIngredientRecipe && Boolean(body.customer_ingredient_selection_enabled);\n      const ingredientLines = Array.isArray(body.ingredient_lines) ? body.ingredient_lines : [];\'\'\'\n)'''
new_call = old_call.replace('replace_once(', 'replace_last(', 1)
if old_call not in text:
    raise SystemExit('catalog update-flow patch call not found')
text = text.replace(old_call, new_call, 1)
path.write_text(text, encoding='utf-8')

subprocess.run(['python', str(path)], check=True)
