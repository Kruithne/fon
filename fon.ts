// fon to png atlas
// usage: bun fon.ts <input.fon>
// output files: <basename>-<pointsize>pt.png and <basename>-<pointsize>pt.json

import { readFileSync, writeFileSync } from 'fs';
import { join, parse } from 'path';
import { deflateSync } from 'zlib';

// region buffer
class BufferWrapper {
	buffer: Buffer;
	offset: number;
	
	constructor(buffer?: Buffer) {
		this.buffer = buffer || Buffer.alloc(0);
		this.offset = 0;
	}
	
	static alloc(size: number, fill: boolean = true): BufferWrapper {
		const buf = new BufferWrapper(Buffer.alloc(size));
		if (fill)
			buf.buffer.fill(0);

		return buf;
	}
	
	get byte_length(): number {
		return this.buffer.length;
	}
	
	seek(offset: number): this {
		this.offset = offset;
		return this;
	}
	
	write_uint8(value: number): this {
		this.buffer.writeUInt8(value, this.offset);
		this.offset += 1;
		return this;
	}
	
	write_uint16_le(value: number): this {
		this.buffer.writeUInt16LE(value, this.offset);
		this.offset += 2;
		return this;
	}
	
	write_uint32_le(value: number): this {
		this.buffer.writeUInt32LE(value, this.offset);
		this.offset += 4;
		return this;
	}
	
	write_uint32_be(value: number): this {
		this.buffer.writeUInt32BE(value, this.offset);
		this.offset += 4;
		return this;
	}
	
	write_int32_be(value: number): this {
		this.buffer.writeInt32BE(value, this.offset);
		this.offset += 4;
		return this;
	}
	
	write_buffer(other: BufferWrapper): this {
		other.buffer.copy(this.buffer, this.offset);
		this.offset += other.buffer.length;
		return this;
	}
	
	deflate(): BufferWrapper {
		return new BufferWrapper(deflateSync(this.buffer, { level: 9 }));
	}
	
	get_crc32(): number {
		let crc = 0xFFFFFFFF;
		for (let i = 0; i < this.buffer.length; i++) {
			crc = crc ^ this.buffer[i];
			for (let j = 0; j < 8; j++)
				crc = (crc >>> 1) ^ (0xEDB88320 & -(crc & 1));
		}
		return crc ^ 0xFFFFFFFF;
	}
	
	async write_to_file(path: string): Promise<void> {
		return writeFileSync(path, this.buffer);
	}
}
// endregion

// region png
const paeth = (left: number, up: number, up_left: number): number => {
	const paeth_val = left + up - up_left;
	const paeth_left = Math.abs(paeth_val - left);
	const paeth_up = Math.abs(paeth_val - up);
	const paeth_up_left = Math.abs(paeth_val - up_left);
	
	if (paeth_left <= paeth_up && paeth_left <= paeth_up_left)
		return left;
	
	if (paeth_up <= paeth_up_left)
		return up;
	
	return up_left;
};

type FilterFunc = (data: Buffer, data_ofs: number, byte_width: number, raw: Buffer, raw_ofs: number, bytes_per_pixel: number) => void;
type FilterSumFunc = (data: Buffer, data_ofs: number, byte_width: number, bytes_per_pixel: number) => number;

const FILTERS: Record<number, FilterFunc> = {
	// none
	0: (data, data_ofs, byte_width, raw, raw_ofs, bytes_per_pixel) => {
		for (let x = 0; x < byte_width; x++)
			raw[raw_ofs + x] = data[data_ofs + x];
	},
	
	// sub
	1: (data, data_ofs, byte_width, raw, raw_ofs, bytes_per_pixel) => {
		for (let x = 0; x < byte_width; x++) {
			const left = x >= bytes_per_pixel ? data[data_ofs + x - bytes_per_pixel] : 0;
			const value = data[data_ofs + x] - left;
			raw[raw_ofs + x] = value;
		}
	},
	
	// up
	2: (data, data_ofs, byte_width, raw, raw_ofs, bytes_per_pixel) => {
		for (let x = 0; x < byte_width; x++) {
			const up = data_ofs > 0 ? data[data_ofs + x - byte_width] : 0;
			const value = data[data_ofs + x] - up;
			raw[raw_ofs + x] = value;
		}
	},
	
	// average
	3: (data, data_ofs, byte_width, raw, raw_ofs, bytes_per_pixel) => {
		for (let x = 0; x < byte_width; x++) {
			const left = x >= bytes_per_pixel ? data[data_ofs + x - bytes_per_pixel] : 0;
			const up = data_ofs > 0 ? data[data_ofs + x - byte_width] : 0;
			const value = data[data_ofs + x] - ((left + up) >> 1);
			raw[raw_ofs + x] = value;
		}
	},
	
	// paeth
	4: (data, data_ofs, byte_width, raw, raw_ofs, bytes_per_pixel) => {
		for (let x = 0; x < byte_width; x++) {
			const left = x >= bytes_per_pixel ? data[data_ofs + x - bytes_per_pixel] : 0;
			const up = data_ofs > 0 ? data[data_ofs + x - byte_width] : 0;
			const up_left = data_ofs > 0 && x >= bytes_per_pixel ? data[data_ofs + x - (byte_width + bytes_per_pixel)] : 0;
			const value = data[data_ofs + x] - paeth(left, up, up_left);
			raw[raw_ofs + x] = value;
		}
	}
};

const FILTER_SUMS: Record<number, FilterSumFunc> = {
	// none
	0: (data, data_ofs, byte_width, bytes_per_pixel) => {
		let sum = 0;
		for (let i = data_ofs, len = data_ofs + byte_width; i < len; i++)
			sum += Math.abs(data[i]);
		return sum;
	},
	
	// sub
	1: (data, data_ofs, byte_width, bytes_per_pixel) => {
		let sum = 0;
		for (let x = 0; x < byte_width; x++) {
			const left = x >= bytes_per_pixel ? data[data_ofs + x - bytes_per_pixel] : 0;
			const value = data[data_ofs + x] - left;
			sum += Math.abs(value);
		}
		return sum;
	},
	
	// up
	2: (data, data_ofs, byte_width, bytes_per_pixel) => {
		let sum = 0;
		for (let x = data_ofs, len = data_ofs + byte_width; x < len; x++) {
			const up = data_ofs > 0 ? data[x - byte_width] : 0;
			const value = data[x] - up;
			sum += Math.abs(value);
		}
		return sum;
	},
	
	// average
	3: (data, data_ofs, byte_width, bytes_per_pixel) => {
		let sum = 0;
		for (let x = 0; x < byte_width; x++) {
			const left = x >= bytes_per_pixel ? data[data_ofs + x - bytes_per_pixel] : 0;
			const up = data_ofs > 0 ? data[data_ofs + x - byte_width] : 0;
			const value = data[data_ofs + x] - ((left + up) >> 1);
			sum += Math.abs(value);
		}
		return sum;
	},
	
	// paeth
	4: (data, data_ofs, byte_width, bytes_per_pixel) => {
		let sum = 0;
		for (let x = 0; x < byte_width; x++) {
			const left = x >= bytes_per_pixel ? data[data_ofs + x - bytes_per_pixel] : 0;
			const up = data_ofs > 0 ? data[data_ofs + x - byte_width] : 0;
			const up_left = data_ofs > 0 && x >= bytes_per_pixel ? data[data_ofs + x - (byte_width + bytes_per_pixel)] : 0;
			const value = data[data_ofs + x] - paeth(left, up, up_left);
			sum += Math.abs(value);
		}
		return sum;
	}
};

const filter = (data: Buffer, width: number, height: number, bytes_per_pixel: number): Buffer => {
	const byte_width = width * bytes_per_pixel;
	let data_ofs = 0;
	
	let raw_ofs = 0;
	const raw = Buffer.alloc((byte_width + 1) * height);
	
	let selected_filter = 0;
	for (let y = 0; y < height; y++) {
		let min = Infinity;
		
		for (let i = 0, len = Object.keys(FILTERS).length; i < len; i++) {
			const sum = FILTER_SUMS[i](data, data_ofs, byte_width, bytes_per_pixel);
			if (sum < min) {
				selected_filter = i;
				min = sum;
			}
		}
		
		raw[raw_ofs] = selected_filter;
		raw_ofs++;
		
		FILTERS[selected_filter](data, data_ofs, byte_width, raw, raw_ofs, bytes_per_pixel);
		raw_ofs += byte_width;
		data_ofs += byte_width;
	}
	return raw;
};

class PNGWriter {
	width: number;
	height: number;
	bytes_per_pixel: number;
	bit_depth: number;
	color_type: number;
	data: Buffer;
	
	constructor(width: number, height: number) {
		this.width = width;
		this.height = height;
		this.bytes_per_pixel = 4;
		this.bit_depth = 8;
		this.color_type = 6; // rgba
		this.data = Buffer.alloc(width * height * 4);
	}
	
	get_pixel_data(): Buffer {
		return this.data;
	}
	
	get_buffer(): BufferWrapper {
		const filtered = new BufferWrapper(filter(this.data, this.width, this.height, this.bytes_per_pixel));
		const deflated = filtered.deflate();
		const buf = BufferWrapper.alloc(8 + 25 + deflated.byte_length + 12 + 12, false);
		
		// 8-byte png signature
		buf.write_uint32_le(0x474E5089);
		buf.write_uint32_le(0x0A1A0A0D);
		
		const ihdr = BufferWrapper.alloc(4 + 13, false);
		ihdr.write_uint32_le(0x52444849); // IHDR
		ihdr.write_uint32_be(this.width);
		ihdr.write_uint32_be(this.height);
		ihdr.write_uint8(this.bit_depth);
		ihdr.write_uint8(this.color_type);
		ihdr.write_uint8(0); // compression
		ihdr.write_uint8(0); // filter
		ihdr.write_uint8(0); // interlace
		ihdr.seek(0);
		
		buf.write_uint32_be(13);
		buf.write_buffer(ihdr);
		buf.write_int32_be(ihdr.get_crc32());
		
		const idat = BufferWrapper.alloc(4 + deflated.byte_length, false);
		idat.write_uint32_le(0x54414449); // IDAT
		idat.write_buffer(deflated);
		
		idat.seek(0);
		
		buf.write_uint32_be(deflated.byte_length);
		buf.write_buffer(idat);
		buf.write_int32_be(idat.get_crc32());
		
		buf.write_uint32_be(0);
		buf.write_uint32_le(0x444E4549); // IEND
		buf.write_uint32_le(0x826042AE); // crc iend
		
		return buf;
	}
	
	async write(file: string): Promise<void> {
		return await this.get_buffer().write_to_file(file);
	}
}
// endregion

// region fon
interface CharEntry {
	char_code: number;
	char: string;
	width: number;
	offset: number;
}

interface FontHeader {
	df_version: number;
	df_pixel_height: number;
	df_first_char: number;
	df_last_char: number;
	df_bits_offset: number;
	df_points: number;
	header_size: number;
}

interface FontData {
	header: FontHeader;
	char_table: CharEntry[];
	base_offset: number;
}

interface AtlasChar {
	char: string;
	char_code: number;
	x: number;
	y: number;
	width: number;
	height: number;
}

const parse_basic_header = (buffer: Buffer, offset: number): FontHeader => {
	const version = buffer.readUInt16LE(offset + 0);
	let header_size = version === 0x200 ? 118 : version === 0x300 ? 148 : 117;
	
	return {
		df_version: version,
		df_pixel_height: buffer.readUInt16LE(offset + 88),
		df_first_char: buffer.readUInt8(offset + 95),
		df_last_char: buffer.readUInt8(offset + 96),
		df_bits_offset: buffer.readUInt32LE(offset + 113),
		df_points: buffer.readUInt16LE(offset + 68),
		header_size
	};
};

const parse_char_table = (buffer: Buffer, header: FontHeader, base_offset: number): CharEntry[] => {
	const char_count = header.df_last_char - header.df_first_char + 1;
	const char_table_offset = base_offset + header.header_size;
	const char_table: CharEntry[] = [];
	
	for (let i = 0; i < char_count; i++) {
		const entry_offset = char_table_offset + (i * 4);
		const char_code = header.df_first_char + i;
		char_table.push({
			char_code,
			char: String.fromCharCode(char_code),
			width: buffer.readUInt16LE(entry_offset),
			offset: buffer.readUInt16LE(entry_offset + 2)
		});
	}
	
	return char_table;
};

const extract_character_bitmap = (
	buffer: Buffer,
	base_offset: number,
	header: FontHeader,
	char_entry: CharEntry
): { bitmap: Uint8Array; width: number; height: number } => {
	const width = char_entry.width;
	const height = header.df_pixel_height;
	
	const absolute_offset = base_offset + char_entry.offset;
	const bytes_per_row = Math.ceil(width / 8);
	const total_bytes = bytes_per_row * height;
	
	const bitmap = new Uint8Array(total_bytes);
	
	// fnt format stores bitmap data in planar format for multi-byte rows
	for (let row = 0; row < height; row++) {
		for (let byte_in_row = 0; byte_in_row < bytes_per_row; byte_in_row++) {
			const source_offset = absolute_offset + (byte_in_row * height) + row;
			const dest_offset = row * bytes_per_row + byte_in_row;
			bitmap[dest_offset] = buffer[source_offset];
		}
	}
	
	return { bitmap, width, height };
};

const extract_font_resources = (buffer: Buffer): number[] => {
	const ne_offset = buffer.readUInt32LE(0x3C);
	const resource_table_offset = buffer.readUInt16LE(ne_offset + 0x24) + ne_offset;
	const alignment_shift = buffer.readUInt16LE(resource_table_offset);
	
	let offset = resource_table_offset + 2;
	const font_resources: number[] = [];
	
	while (true) {
		const type_id = buffer.readUInt16LE(offset);
		if (type_id === 0)
			break;
		
		const resource_count = buffer.readUInt16LE(offset + 2);
		offset += 8;
		
		if (type_id === 0x8008) {
			for (let i = 0; i < resource_count; i++) {
				const resource_offset = buffer.readUInt16LE(offset) << alignment_shift;
				font_resources.push(resource_offset);
				offset += 12;
			}
			
			break;
		} else {
			offset += resource_count * 12;
		}
	}
	
	return font_resources;
};

const parse_font_data = (buffer: Buffer, offset: number): FontData => {
	const header = parse_basic_header(buffer, offset);
	const char_table = parse_char_table(buffer, header, offset);
	
	return {
		header,
		char_table,
		base_offset: offset
	};
};

const calculate_atlas_dimensions = (char_table: CharEntry[], char_height: number): { size: number; cols: number; rows: number } => {
	const valid_chars = char_table.filter(c => c.width > 0);
	const char_count = valid_chars.length;
	
	const max_char_width = Math.max(...valid_chars.map(c => c.width));
	
	const cols = Math.ceil(Math.sqrt(char_count));
	const rows = Math.ceil(char_count / cols);
	
	const atlas_width = cols * max_char_width;
	const atlas_height = rows * char_height;
	
	const size = Math.max(atlas_width, atlas_height);
	
	return { size, cols, rows };
};

const create_atlas = (buffer: Buffer, font_data: FontData, output_base_name: string): void => {
	const { header, char_table, base_offset } = font_data;
	
	const valid_chars = char_table.filter(c => c.width > 0);
	
	if (valid_chars.length === 0) {
		console.log(`  warning: no valid characters found in ${header.df_points}pt font, skipping...`);
		return;
	}
	
	const char_height = header.df_pixel_height;
	const max_char_width = Math.max(...valid_chars.map(c => c.width));
	
	const { size, cols } = calculate_atlas_dimensions(valid_chars, char_height);
	
	const png = new PNGWriter(size, size);
	const pixel_data = png.get_pixel_data();
	
	pixel_data.fill(0);
	
	const atlas_map: Record<string, AtlasChar> = {};
	
	let char_index = 0;
	for (const char_entry of valid_chars) {
		const col = char_index % cols;
		const row = Math.floor(char_index / cols);
		
		const x = col * max_char_width;
		const y = row * char_height;
		
		const { bitmap, width, height } = extract_character_bitmap(buffer, base_offset, header, char_entry);
		
		const bytes_per_row = Math.ceil(width / 8);
		for (let py = 0; py < height; py++) {
			for (let px = 0; px < width; px++) {
				const byte_index = py * bytes_per_row + Math.floor(px / 8);
				const bit_index = 7 - (px % 8);
				const pixel = (bitmap[byte_index] >> bit_index) & 1;
				
				if (pixel) {
					const atlas_x = x + px;
					const atlas_y = y + py;
					const pixel_index = (atlas_y * size + atlas_x) * 4;
					
					pixel_data[pixel_index] = 255;
					pixel_data[pixel_index + 1] = 255;
					pixel_data[pixel_index + 2] = 255;
					pixel_data[pixel_index + 3] = 255;
				}
			}
		}
		
		const key = char_entry.char === '"' ? '\\"' : char_entry.char === '\\' ? '\\\\' : char_entry.char;
		atlas_map[key] = {
			char: char_entry.char,
			char_code: char_entry.char_code,
			x,
			y,
			width,
			height
		};
		
		char_index++;
	}
	
	const png_file = `${output_base_name}-${header.df_points}pt.png`;
	const json_file = `${output_base_name}-${header.df_points}pt.json`;
	
	png.write(png_file);
	
	const json_data = {
		font_name: `${parse(output_base_name).name} ${header.df_points}pt`,
		point_size: header.df_points,
		pixel_height: header.df_pixel_height,
		atlas_size: size,
		char_count: valid_chars.length,
		characters: atlas_map
	};
	
	writeFileSync(json_file, JSON.stringify(json_data, null, 2));
	
	console.log(`  ✓ ${png_file} (${size}x${size}, ${valid_chars.length} chars)`);
	console.log(`  ✓ ${json_file}`);
};
// endregion

// region main
(() => {
	const args = process.argv.slice(2);
	
	if (args.length === 0) {
		console.error('usage: bun fon.ts <input.fon>');
		process.exit(1);
	}
	
	const input_file = args[0];
	let buffer: Buffer;
	
	try {
		buffer = readFileSync(input_file);
	} catch (err) {
		console.error(`error reading file: ${input_file}`);
		console.error(err);
		process.exit(1);
	}
	
	const { dir, name } = parse(input_file);
	const output_base_name = dir ? join(dir, name) : name;
	
	console.log(`converting ${input_file}...\n`);
	
	const font_resources = extract_font_resources(buffer);
	console.log(`found ${font_resources.length} font variant(s)\n`);
	
	if (font_resources.length === 0) {
		console.error('no font resources found in file');
		process.exit(1);
	}
	
	for (let i = 0; i < font_resources.length; i++) {
		const font_data = parse_font_data(buffer, font_resources[i]);
		console.log(`font ${i + 1}: ${font_data.header.df_points}pt (${font_data.header.df_pixel_height}px height)`);
		
		try {
			create_atlas(buffer, font_data, output_base_name);
		} catch (err) {
			console.error(`  error creating atlas: ${err}`);
		}
		
		console.log();
	}
})();
// endregion