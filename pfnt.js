#!/usr/bin/env bun

import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';

const font_name = process.argv[2];
if (!font_name) {
	console.error('Usage: bun pfnt.js <font-name>');
	console.error('Example: bun pfnt.js sserife');
	process.exit(1);
}

const dir = import.meta.dir;

const files = readdirSync(dir);
const font_files = files.filter(f => f.startsWith(font_name + '-') && (f.endsWith('.json') || f.endsWith('.png')));

if (font_files.length === 0) {
	console.error(`No files found for font: ${font_name}`);
	process.exit(1);
}

const sizes = new Map();
for (const file of font_files) {
	const match = file.match(/^(.+)-(\d+pt)\.(json|png)$/);
	if (match) {
		const [, name, size, ext] = match;
		if (!sizes.has(size))
			sizes.set(size, {});

		sizes.get(size)[ext] = join(dir, file);
	}
}

console.log(`Found ${sizes.size} font sizes for ${font_name}`);

const size_entries = [];
for (const [size, paths] of sizes.entries()) {
	if (!paths.json || !paths.png) {
		console.warn(`Skipping ${size}: missing json or png`);
		continue;
	}

	console.log(`Processing ${size}...`);

	const json = JSON.parse(readFileSync(paths.json, 'utf-8'));
	const png = readFileSync(paths.png);

	const chars = [];
	for (const [char, data] of Object.entries(json.characters)) {
		chars.push({
			code: data.char_code,
			char: char,
			x: data.x,
			y: data.y,
			width: data.width,
			height: data.height
		});
	}

	chars.sort((a, b) => a.code - b.code);

	size_entries.push({
		size: size,
		pixel_height: json.pixel_height,
		chars: chars,
		png: png
	});
}

if (size_entries.length === 0) {
	console.error('No valid font sizes found');
	process.exit(1);
}

const buffers = [];

const header = Buffer.alloc(10);
header.write('PFNT', 0);
header.writeUInt32LE(1, 4);
header.writeUInt16LE(size_entries.length, 8);
buffers.push(header);

const toc_buffer = Buffer.alloc(size_entries.length * 18);
let current_offset = 10 + toc_buffer.length;

for (let i = 0; i < size_entries.length; i++) {
	const entry = size_entries[i];
	const pt_size = parseInt(entry.size.replace('pt', ''));
	const toc_offset = i * 18;

	toc_buffer.writeUInt16LE(pt_size, toc_offset);
	toc_buffer.writeUInt16LE(entry.pixel_height, toc_offset + 2);
	toc_buffer.writeUInt16LE(entry.chars.length, toc_offset + 4);
	toc_buffer.writeUInt32LE(current_offset, toc_offset + 6);

	const char_map_size = entry.chars.length * 8;
	const png_offset = current_offset + char_map_size;
	toc_buffer.writeUInt32LE(png_offset, toc_offset + 10);
	toc_buffer.writeUInt32LE(entry.png.length, toc_offset + 14);

	const char_map = Buffer.alloc(char_map_size);
	for (let j = 0; j < entry.chars.length; j++) {
		const char = entry.chars[j];
		char_map.writeUInt16LE(char.code, j * 8);
		char_map.writeUInt16LE(char.x, j * 8 + 2);
		char_map.writeUInt16LE(char.y, j * 8 + 4);
		char_map.writeUInt8(char.width, j * 8 + 6);
		char_map.writeUInt8(char.height, j * 8 + 7);
	}

	buffers.push(char_map);
	buffers.push(entry.png);

	current_offset = png_offset + entry.png.length;
}

buffers.splice(1, 0, toc_buffer);

const output = Buffer.concat(buffers);
const output_path = join(dir, `${font_name}.pfnt`);
writeFileSync(output_path, output);

console.log(`Created ${output_path} (${output.length} bytes)`);
console.log(`Sizes included: ${size_entries.map(e => e.size).join(', ')}`);
