"""
Face recognition pipeline for Fiesta 50 (MYN50).

Usage:
  # Process both sources:
  python process_photos.py --selfies ./selfies --whatsapp ./party_whatsapp --pro ./party_pro --output ../data/mappings.json

  # Process only one source:
  python process_photos.py --selfies ./selfies --pro ./party_pro --output ../data/mappings.json

Steps:
  1. Load reference selfies and generate face encodings
  2. Process each photo source (whatsapp / pro), detect faces, match against known encodings
  3. Output mappings.json with per-source guest_to_photos mapping
"""

import os
import sys
import json
import argparse
from pathlib import Path

import face_recognition
from PIL import Image
from tqdm import tqdm


def load_reference_faces(selfies_dir):
    """Load selfie images and generate face encodings for each guest."""
    encodings = {}
    selfies_path = Path(selfies_dir)

    if not selfies_path.exists():
        print(f"Error: Selfies directory not found: {selfies_dir}")
        sys.exit(1)

    files = list(selfies_path.glob("*.jpg")) + list(selfies_path.glob("*.jpeg")) + list(selfies_path.glob("*.png"))
    print(f"Loading {len(files)} reference selfies...")

    for file in tqdm(files, desc="Encoding selfies"):
        guest_id = file.stem
        image = face_recognition.load_image_file(str(file))
        face_encs = face_recognition.face_encodings(image)

        if len(face_encs) == 0:
            print(f"  WARNING: No face found in {file.name} - skipping")
            continue
        if len(face_encs) > 1:
            print(f"  WARNING: Multiple faces in {file.name} - using first one")

        encodings[guest_id] = face_encs[0]

    print(f"Successfully encoded {len(encodings)} faces out of {len(files)} selfies")
    return encodings


def process_photo_source(source_dir, known_encodings, tolerance=0.55, model="hog"):
    """Process photos from a single source directory and match faces."""
    source_path = Path(source_dir)

    if not source_path.exists():
        print(f"Warning: Source directory not found: {source_dir} - skipping")
        return {}, {"total_photos": 0, "photos_with_faces": 0, "total_faces_found": 0, "total_matches": 0}

    files = sorted(
        list(source_path.glob("*.jpg"))
        + list(source_path.glob("*.jpeg"))
        + list(source_path.glob("*.png"))
        + list(source_path.glob("*.JPG"))
        + list(source_path.glob("*.JPEG"))
    )
    print(f"\nProcessing {len(files)} photos from {source_dir} (tolerance={tolerance})...")

    known_ids = list(known_encodings.keys())
    known_encs = [known_encodings[gid] for gid in known_ids]

    mappings = {}
    stats = {"total_photos": len(files), "photos_with_faces": 0, "total_faces_found": 0, "total_matches": 0}

    for file in tqdm(files, desc=f"Processing {source_path.name}"):
        photo_id = file.stem
        image = face_recognition.load_image_file(str(file))

        face_locations = face_recognition.face_locations(image, model=model)
        face_encs = face_recognition.face_encodings(image, face_locations)

        if not face_encs:
            mappings[photo_id] = []
            continue

        stats["photos_with_faces"] += 1
        stats["total_faces_found"] += len(face_encs)

        matched_guests = set()

        for face_enc in face_encs:
            matches = face_recognition.compare_faces(known_encs, face_enc, tolerance=tolerance)
            for i, match in enumerate(matches):
                if match:
                    matched_guests.add(known_ids[i])
                    stats["total_matches"] += 1

        mappings[photo_id] = sorted(list(matched_guests))

    return mappings, stats


def generate_reverse_mappings_by_source(sources):
    """Generate guest_id → { source: [photo_ids] } from per-source photo_to_guests."""
    reverse = {}

    for source_name, photo_mappings in sources.items():
        for photo_id, guest_ids in photo_mappings.items():
            for gid in guest_ids:
                if gid not in reverse:
                    reverse[gid] = {}
                if source_name not in reverse[gid]:
                    reverse[gid][source_name] = []
                reverse[gid][source_name].append(photo_id)

    return reverse


def main():
    parser = argparse.ArgumentParser(description="Face recognition for MYN50")
    parser.add_argument("--selfies", required=True, help="Directory with reference selfies")
    parser.add_argument("--whatsapp", default=None, help="Directory with WhatsApp guest photos")
    parser.add_argument("--pro", default=None, help="Directory with professional photographer photos")
    parser.add_argument("--output", required=True, help="Output JSON file path")
    parser.add_argument("--tolerance", type=float, default=0.55,
                        help="Face match tolerance (lower = stricter, default 0.55)")
    parser.add_argument("--model", choices=["hog", "cnn"], default="hog",
                        help="Face detection model (hog=fast/CPU, cnn=accurate/GPU)")
    args = parser.parse_args()

    if not args.whatsapp and not args.pro:
        print("Error: Provide at least one of --whatsapp or --pro")
        sys.exit(1)

    # Step 1: Load reference faces
    known_encodings = load_reference_faces(args.selfies)

    if not known_encodings:
        print("No reference faces loaded. Exiting.")
        sys.exit(1)

    # Step 2: Process each source
    all_photo_to_guests = {}
    all_stats = {}

    if args.whatsapp:
        mappings, stats = process_photo_source(args.whatsapp, known_encodings, args.tolerance, args.model)
        all_photo_to_guests["whatsapp"] = mappings
        all_stats["whatsapp"] = stats

    if args.pro:
        mappings, stats = process_photo_source(args.pro, known_encodings, args.tolerance, args.model)
        all_photo_to_guests["pro"] = mappings
        all_stats["pro"] = stats

    # Step 3: Generate reverse mappings (guest → { source: [photos] })
    reverse_mappings = generate_reverse_mappings_by_source(all_photo_to_guests)

    # Step 4: Save output
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    output_data = {
        "photo_to_guests": all_photo_to_guests,
        "guest_to_photos": reverse_mappings,
        "stats": all_stats,
    }

    with open(output_path, "w") as f:
        json.dump(output_data, f, indent=2, ensure_ascii=False)

    # Print summary
    print(f"\n{'='*50}")
    print(f"RESULTS")
    print(f"{'='*50}")

    for source_name, stats in all_stats.items():
        print(f"\n--- {source_name.upper()} ---")
        print(f"  Total photos:       {stats['total_photos']}")
        print(f"  Photos with faces:  {stats['photos_with_faces']}")
        print(f"  Total faces found:  {stats['total_faces_found']}")
        print(f"  Total matches:      {stats['total_matches']}")

    print(f"\nGuests identified:    {len(reverse_mappings)}")
    print(f"Output saved to:      {output_path}")

    print(f"\nPhotos per guest:")
    for gid in sorted(reverse_mappings, key=lambda x: sum(len(v) for v in reverse_mappings[x].values()), reverse=True):
        counts = {s: len(photos) for s, photos in reverse_mappings[gid].items()}
        total = sum(counts.values())
        detail = ", ".join(f"{s}={c}" for s, c in counts.items())
        print(f"  {gid}: {total} photos ({detail})")


if __name__ == "__main__":
    main()
