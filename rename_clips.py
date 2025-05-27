import argparse
import os
import random
import shutil
import string

def generate_random_name(length=20):
    """Generates a random string of digits."""
    return ''.join(random.choices(string.digits, k=length))

def main():
    parser = argparse.ArgumentParser(description="Rename and copy MP4 clips.")
    parser.add_argument(
        "--input_dirs",
        nargs="+",
        required=True,
        help="List of input directories to search for MP4 files."
    )
    parser.add_argument(
        "--output_dir",
        default="output/random_names",
        help="Output directory to store renamed MP4 files (default: output/random_names)."
    )
    args = parser.parse_args()

    # Create output directory if it doesn't exist
    os.makedirs(args.output_dir, exist_ok=True)
    print(f"Output directory: {args.output_dir}")

    processed_files = set()

    for input_dir in args.input_dirs:
        if not os.path.isdir(input_dir):
            print(f"Error: Input directory '{input_dir}' does not exist. Skipping.")
            continue
        
        print(f"Processing directory: {input_dir}")
        for root, _, files in os.walk(input_dir):
            for filename in files:
                if filename.endswith(".mp4"):
                    filepath = os.path.join(root, filename)
                    
                    # Generate a unique random name
                    while True:
                        new_name = generate_random_name() + ".mp4"
                        if new_name not in processed_files:
                            processed_files.add(new_name)
                            break
                    
                    output_filepath = os.path.join(args.output_dir, new_name)
                    
                    try:
                        shutil.copy2(filepath, output_filepath)
                        print(f"Copied '{filepath}' to '{output_filepath}'")
                    except Exception as e:
                        print(f"Error copying '{filepath}': {e}")

if __name__ == "__main__":
    main()
