let fontsPromise: Promise<string> | null = null;

export function frameStyles(): Promise<string> {
  if (!fontsPromise) {
    fontsPromise = (async () => {
      const fonts: Promise<string>[] = [];
      for (const sheet of Array.from(document.styleSheets)) {
        let rules: CSSRuleList;
        try {
          rules = sheet.cssRules;
        } catch {
          continue;
        }
        for (const rule of Array.from(rules)) {
          if (!(rule instanceof CSSFontFaceRule)) continue;
          const css = rule.cssText;
          const match = /url\(["']?([^"')]+)["']?\)/.exec(css);
          if (!match) continue;
          const url = new URL(match[1], sheet.href || document.baseURI).href;
          fonts.push(fetch(url).then((response) => {
            if (!response.ok) throw new Error(`Font download failed (${response.status}): ${url}`);
            return response.blob();
          }).then((blob) => new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(css.replace(match[0], `url("${reader.result}")`));
            reader.onerror = () => reject(new Error(`Font reading failed: ${url}`));
            reader.readAsDataURL(blob);
          })));
        }
      }
      const cs = getComputedStyle(document.documentElement);
      const vars = ["--font-body", "--font-ui", "--font-hebrew-text", "--font-hebrew"]
        .map((v) => `${v}:${cs.getPropertyValue(v)};`).join("");
      return `${(await Promise.all(fonts)).join("\n")}\n:root{${vars}}`;
    })();
  }
  return fontsPromise;
}
