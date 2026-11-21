import {
  LINE_SIZE_MAX,
  LINE_SIZE_MIN,
  TITLE_FONTS,
  WARMTH_MAX,
  WARMTH_MIN,
  lineColorOf,
  lineSizeOf,
  titleFontFamily,
  titleFontOf,
  warmthOf,
} from "../shared/canvas";

export function StyleFields({
  font,
  lineSize,
  lineColor,
  warmth,
  pasted,
  pasteHint,
  onFont,
  onLineSize,
  onLineColor,
  onWarmth,
  onPasted,
  onPaste,
}: {
  font: string | undefined;
  lineSize: number | undefined;
  lineColor: string | undefined;
  warmth: number | undefined;
  pasted: string;
  pasteHint: string;
  onFont: (font: string) => void;
  onLineSize: (size: number) => void;
  onLineColor: (color: string) => void;
  onWarmth: (warmth: number) => void;
  onPasted: (text: string) => void;
  onPaste: () => void;
}) {
  const face = titleFontOf(font);
  const size = lineSizeOf(lineSize);
  const swatch = lineColorOf(lineColor);
  const wash = warmthOf(warmth);
  return (
    <div className="style-block">
      <p className="rail-label">Text and style</p>
      <label className="stack">
        <span>Font for the title</span>
        <select
          className="field"
          aria-label="Font for the title"
          value={face}
          style={{ fontFamily: titleFontFamily(face) }}
          onChange={(event) => onFont(event.target.value)}
        >
          {TITLE_FONTS.map((item) => (
            <option key={item} value={item} style={{ fontFamily: titleFontFamily(item) }}>
              {item}
            </option>
          ))}
        </select>
      </label>
      <label className="stack">
        <span>Size of the caption</span>
        <span className="stroke-line">
          <input
            type="range"
            min={LINE_SIZE_MIN}
            max={LINE_SIZE_MAX}
            value={size}
            aria-label="Size of the caption"
            onChange={(event) => onLineSize(Number(event.target.value))}
          />
          <input
            className="field stroke-num"
            type="number"
            min={LINE_SIZE_MIN}
            max={LINE_SIZE_MAX}
            value={size}
            aria-label="Size of the caption amount"
            onChange={(event) => onLineSize(Number(event.target.value) || LINE_SIZE_MIN)}
          />
        </span>
      </label>
      <label className="stack">
        <span>Color of the caption</span>
        <span className="color-line">
          <input type="color" value={swatch} aria-label="Color of the caption" onChange={(event) => onLineColor(event.target.value)} />
          <input
            className="field hex"
            spellCheck={false}
            value={(lineColor?.trim() || swatch).toUpperCase()}
            aria-label="Color of the caption hex"
            onChange={(event) => {
              const next = event.target.value.trim();
              onLineColor(next.startsWith("#") ? next : `#${next}`);
            }}
          />
        </span>
      </label>
      <label className="stack">
        <span>Cool or warm picture</span>
        <span className="stroke-line warmth-line">
          <span className="warmth-end">Cool</span>
          <input
            type="range"
            min={WARMTH_MIN}
            max={WARMTH_MAX}
            value={wash}
            aria-label="Cool or warm picture"
            onChange={(event) => onWarmth(Number(event.target.value))}
          />
          <span className="warmth-end">Warm</span>
        </span>
      </label>
      <label className="stack">
        <span>Paste captions</span>
        <textarea
          className="field"
          rows={3}
          value={pasted}
          placeholder="One caption per clip"
          aria-label="Paste captions"
          onChange={(event) => onPasted(event.target.value)}
        />
      </label>
      <p className="file-note">{pasteHint}</p>
      <button type="button" className="btn style-paste" onClick={onPaste}>
        Paste in order
      </button>
    </div>
  );
}
