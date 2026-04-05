"""
Upload party photos to Cloudflare R2.

Usage:
  python upload_party_photos.py --source ./party_photos --type pro
  python upload_party_photos.py --source ./party_photos --type whatsapp

Reads R2 credentials from .env file in the backend directory.
Uploads to party-pro/ or party-whatsapp/ prefix based on --type.
"""

import os
import sys
import argparse
from pathlib import Path

import boto3
from dotenv import load_dotenv
from tqdm import tqdm
from PIL import Image
import io

# Load env from backend
load_dotenv(Path(__file__).parent.parent / "backend" / ".env")


def get_r2_client():
    return boto3.client(
        "s3",
        endpoint_url=f"https://{os.environ['R2_ACCOUNT_ID']}.r2.cloudflarestorage.com",
        aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
        region_name="auto",
    )


def resize_for_web(image_path, max_width=1920, quality=85):
    """Resize image for web delivery, return bytes."""
    img = Image.open(image_path)

    # Auto-rotate based on EXIF
    from PIL import ImageOps
    img = ImageOps.exif_transpose(img)

    # Resize if larger than max_width
    if img.width > max_width:
        ratio = max_width / img.width
        new_height = int(img.height * ratio)
        img = img.resize((max_width, new_height), Image.LANCZOS)

    buffer = io.BytesIO()
    img.save(buffer, format="JPEG", quality=quality, optimize=True)
    return buffer.getvalue()


def main():
    parser = argparse.ArgumentParser(description="Upload party photos to R2")
    parser.add_argument("--source", required=True, help="Directory with party photos")
    parser.add_argument("--type", required=True, choices=["pro", "whatsapp"],
                        help="Photo source type: 'pro' or 'whatsapp'")
    parser.add_argument("--max-width", type=int, default=1920, help="Max image width (default 1920)")
    parser.add_argument("--quality", type=int, default=85, help="JPEG quality (default 85)")
    args = parser.parse_args()

    r2_prefix = f"party-{args.type}"

    source = Path(args.source)
    if not source.exists():
        print(f"Error: Directory not found: {source}")
        sys.exit(1)

    files = sorted(
        list(source.glob("*.jpg"))
        + list(source.glob("*.jpeg"))
        + list(source.glob("*.png"))
        + list(source.glob("*.JPG"))
        + list(source.glob("*.JPEG"))
        + list(source.glob("*.PNG"))
    )

    print(f"Found {len(files)} photos to upload")
    bucket = os.environ["R2_BUCKET_NAME"]
    client = get_r2_client()

    for file in tqdm(files, desc="Uploading"):
        photo_id = file.stem
        key = f"{r2_prefix}/{photo_id}.jpg"

        # Resize and optimize
        image_data = resize_for_web(file, args.max_width, args.quality)

        client.put_object(
            Bucket=bucket,
            Key=key,
            Body=image_data,
            ContentType="image/jpeg",
        )

    print(f"\nUploaded {len(files)} photos to R2 bucket '{bucket}'")
    print(f"Public URL prefix: {os.environ['R2_PUBLIC_URL']}/{r2_prefix}/")


if __name__ == "__main__":
    main()
