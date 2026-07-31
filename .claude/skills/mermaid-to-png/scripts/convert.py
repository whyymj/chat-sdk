#!/usr/bin/env python3
"""
Mermaid to PNG Converter
Extracts mermaid diagrams from markdown files and converts them to PNG using mermaid-cli (mmdc).
"""

import re
import os
import sys
import subprocess
import tempfile
import argparse
from pathlib import Path


def extract_mermaid_diagrams(file_path):
    """Extract mermaid code blocks from a markdown file."""
    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()

    # Match mermaid code blocks
    pattern = r'```mermaid\n(.*?)```'
    matches = re.findall(pattern, content, re.DOTALL)

    diagrams = []
    for i, match in enumerate(matches, 1):
        code = match.strip()
        # Remove title lines if present
        lines = code.split('\n')
        if lines and lines[0].startswith('# '):
            code = '\n'.join(lines[1:]).strip()

        if code:
            diagrams.append({
                'index': i,
                'code': code
            })

    return diagrams


def convert_to_png(diagrams, output_dir, background='white', scale=2):
    """Convert mermaid diagrams to PNG using mmdc."""
    os.makedirs(output_dir, exist_ok=True)

    with tempfile.TemporaryDirectory() as temp_dir:
        for diagram in diagrams:
            # Write temporary mmd file
            temp_mmd = os.path.join(temp_dir, f'diagram_{diagram["index"]}.mmd')
            with open(temp_mmd, 'w', encoding='utf-8') as f:
                f.write(diagram['code'])

            # Output PNG path
            output_png = os.path.join(output_dir, f'diagram_{diagram["index"]}.png')

            print(f"\n[{diagram['index']}/{len(diagrams)}] Generating: {output_png}")

            # Build mmdc command
            cmd = [
                'mmdc',
                '-i', temp_mmd,
                '-o', output_png,
                '-b', background,
                '-s', str(scale)
            ]

            try:
                result = subprocess.run(
                    cmd,
                    capture_output=True,
                    text=True,
                    timeout=60
                )

                if result.returncode == 0 and os.path.exists(output_png):
                    size = os.path.getsize(output_png)
                    print(f"✅ Success! Size: {size/1024:.1f} KB")
                else:
                    print(f"❌ Failed!")
                    if result.stderr:
                        print(f"   Error: {result.stderr[:200]}")

            except subprocess.TimeoutExpired:
                print(f"❌ Timeout!")
            except FileNotFoundError:
                print(f"❌ mmdc not found. Install with: npm install -g @mermaid-js/mermaid-cli")
                return False
            except Exception as e:
                print(f"❌ Error: {e}")

    return True


def convert_single_file(input_file, output_file=None, background='white', scale=2):
    """Convert a single mmd file to PNG."""
    if not output_file:
        output_file = str(Path(input_file).with_suffix('.png'))

    cmd = [
        'mmdc',
        '-i', input_file,
        '-o', output_file,
        '-b', background,
        '-s', str(scale)
    ]

    try:
        print(f"Converting: {input_file} -> {output_file}")
        subprocess.run(cmd, check=True, capture_output=True)
        size = os.path.getsize(output_file)
        print(f"✅ Success! Size: {size/1024:.1f} KB")
        return True
    except Exception as e:
        print(f"❌ Failed: {e}")
        return False


def main():
    parser = argparse.ArgumentParser(
        description='Convert Mermaid diagrams to PNG images'
    )
    parser.add_argument('input', help='Input file (.mmd or .md)')
    parser.add_argument('-o', '--output', help='Output directory or file')
    parser.add_argument('-b', '--background', default='white',
                        help='Background color (white, transparent, or hex)')
    parser.add_argument('-s', '--scale', type=int, default=2,
                        help='Scale factor (default: 2)')

    args = parser.parse_args()

    if not os.path.exists(args.input):
        print(f"Error: File not found: {args.input}")
        sys.exit(1)

    # Check if input is a single .mmd file
    if args.input.endswith('.mmd'):
        convert_single_file(
            args.input,
            args.output,
            args.background,
            args.scale
        )
    else:
        # Treat as markdown file with multiple diagrams
        print(f"Processing: {args.input}")

        output_dir = args.output or 'flowchart_png'

        diagrams = extract_mermaid_diagrams(args.input)
        print(f"Found {len(diagrams)} diagram(s)\n")

        if not diagrams:
            print("No mermaid diagrams found in file")
            sys.exit(1)

        success = convert_to_png(diagrams, output_dir, args.background, args.scale)

        if success:
            print("\n" + "="*50)
            print("Done!")
            print("="*50)

            if os.path.exists(output_dir):
                files = os.listdir(output_dir)
                png_files = [f for f in files if f.endswith('.png')]
                print(f"\nGenerated {len(png_files)} PNG file(s):")
                for f in sorted(png_files):
                    path = os.path.join(output_dir, f)
                    size = os.path.getsize(path)
                    print(f"  - {f} ({size/1024:.1f} KB)")


if __name__ == '__main__':
    main()
