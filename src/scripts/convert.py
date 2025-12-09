#!/usr/bin/env python3
import sys
import os
import argparse
import json

# --- MUTE FREECAD NOISE ---
class DevNull:
    def write(self, _: str):
        pass
    def flush(self):
        pass

sys.stdout = DevNull()      # silence FreeCAD progress
sys.stderr = DevNull()      # silence FreeCAD warnings

# REAL stdout for JSON only
real_stdout = sys.__stdout__

# FreeCAD imports
try:
    import FreeCAD
    import Part
    import Mesh
    import MeshPart
    import Import
except Exception as e:
    real_stdout.write(json.dumps({
        "success": False,
        "stage": "import",
        "error": f"FreeCAD import failed: {str(e)}"
    }) + "\n")
    sys.exit(1)


def convert_stl_to_step(input_path, output_path, tolerance=0.01, repair=True):
    result = {
        "input": input_path,
        "output": output_path,
        "tolerance": tolerance,
        "success": False
    }

    try:
        mesh = Mesh.Mesh()
        mesh.read(input_path)

        if repair:
            mesh.fixSelfIntersections()
            mesh.fixDegenerations()
            mesh.harmonizeNormals()

        shape = Part.Shape()
        shape.makeShapeFromMesh(mesh.Topology, tolerance)

        try:
            shape = Part.makeSolid(shape)
        except:
            pass

        doc = FreeCAD.newDocument("CONVERT")
        obj = doc.addObject("Part::Feature", "Converted")
        obj.Shape = shape

        Import.export([obj], output_path)

        FreeCAD.closeDocument("CONVERT")

        if os.path.exists(output_path):
            result["success"] = True
            result["output_size"] = os.path.getsize(output_path)
        else:
            result["error"] = "STEP export failed"

    except Exception as e:
        result["error"] = str(e)

    return result


def main():
    args = argparse.ArgumentParser()
    args.add_argument("input")
    args.add_argument("output")
    args.add_argument("--tolerance", type=float, default=0.01)
    args.add_argument("--repair", action="store_true")
    args = args.parse_args()

    res = convert_stl_to_step(
        args.input,
        args.output,
        tolerance=args.tolerance,
        repair=args.repair
    )

    real_stdout.write(json.dumps(res) + "\n")


if __name__ == "__main__":
    main()
