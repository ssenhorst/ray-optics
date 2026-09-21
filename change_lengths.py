import json
import math

INPUT_FILE = "data/taskScenes/parabolic_by_parts.json"
OUTPUT_FILE = "data/taskScenes/parabolic_by_parts.json"
TARGET_LENGTH = 35.0


def resize_segment(p1, p2, target_length):
    # Calculate the midpoint
    mid_x = (p1["x"] + p2["x"]) / 2
    mid_y = (p1["y"] + p2["y"]) / 2

    # Calculate the current direction vector
    dx = p2["x"] - p1["x"]
    dy = p2["y"] - p1["y"]

    # Calculate the current length
    current_length = math.hypot(dx, dy)

    if current_length == 0:
        raise ValueError("Cannot resize a zero-length segment.")

    # Normalize the direction vector
    ux = dx / current_length
    uy = dy / current_length

    # Half of the desired length
    half_length = target_length / 2

    # Construct the new endpoints around the same midpoint
    new_p1 = {
        "x": mid_x - ux * half_length,
        "y": mid_y - uy * half_length
    }

    new_p2 = {
        "x": mid_x + ux * half_length,
        "y": mid_y + uy * half_length
    }

    return new_p1, new_p2


# Load the JSON file
with open(INPUT_FILE, "r") as f:
    data = json.load(f)

# Resize every mirror
for obj in data["objs"]:
    if obj.get("type") == "Mirror":
        obj["p1"], obj["p2"] = resize_segment(
            obj["p1"],
            obj["p2"],
            TARGET_LENGTH
        )

# Save the modified JSON
with open(OUTPUT_FILE, "w") as f:
    json.dump(data, f, indent=2)

print(f"Done! All mirrors are now {TARGET_LENGTH} units long.")
print(f"Saved to {OUTPUT_FILE}")
