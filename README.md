# FNT to PNG

Converts FNT (.fon) formats version 2.0 and 3.0 to a PNG atlas with a JSON metadata.

## Usage

```bash
bun fon.ts <input.fon>
```

## Output

For each font size variant in the .FON file, the converter generates two files:

- **`<basename>-<pointsize>pt.png`** - PNG atlas image containing all glyphs in a square grid
- **`<basename>-<pointsize>pt.json`** - JSON metadata mapping characters to atlas positions

### Example Output

From `sserife.fon` (containing 6 font variants):
- `sserife-8pt.png` + `sserife-8pt.json`
- `sserife-10pt.png` + `sserife-10pt.json`
- `sserife-12pt.png` + `sserife-12pt.json`
- `sserife-14pt.png` + `sserife-14pt.json`
- `sserife-18pt.png` + `sserife-18pt.json`
- `sserife-24pt.png` + `sserife-24pt.json`

## JSON Format

```json
{
	"fontName": "sserife 8pt",
	"pointSize": 8,
	"pixelHeight": 13,
	"atlasSize": 195,
	"charCount": 224,
	"characters": {
	"A": {
		"char": "A",
		"charCode": 65,
		"x": 33,
		"y": 26,
		"width": 7,
		"height": 13
	},
	...
	}
}
```