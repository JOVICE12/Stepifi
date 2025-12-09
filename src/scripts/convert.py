#!/usr/bin/env python3
"""
STL to STEP Converter with Mesh Repair + Planar Face Merging
(Forced clean JSON output for use with external processes)
"""

import sys
import os
import argparse
import json

try:
    import FreeCAD
    import Part
    import Mesh
    import MeshPart
    import Import
except ImportError as e:
    print(json.dumps({
        "success": False,
        "error": f"FreeCAD import failed: {str(e)}",
        "stage": "import"
    }))
    sys.exit(0)      # ← FORCE immediate exit


def safe_exit(result):
    """Prints JSON and immediately terminates FreeCAD before it prints anything else."""
    print(json.dumps(result, indent=2))
    sys.stdout.flush()
    os._exit(0)      # ← ← ← HARD EXIT (kills FreeCAD BEFORE progress bars appear)


def get_mesh_info(mesh):
    return {
        "points": mesh.CountPoints,
        "facets": mesh.CountFacets,
        "edges": mesh.CountEdges,
        "is_solid": mesh.isSolid(),
        "has_non_manifolds": mesh.hasNonManifolds(),
        "has_self_intersections": mesh.hasSelfIntersections(),
        "volume": mesh.Volume if mesh.isSolid() else None,
        "area": mesh.Area,
    }


def repair_mesh(mesh):
    repairs = []

    before_pts = mesh.CountPoints
    mesh.removeDuplicatedPoints()
    if mesh.CountPoints < before_pts:
        repairs.append(f"Removed {before_pts - mesh.CountPoints} duplicate points")

    before_facets = mesh.CountFacets
    mesh.removeDuplicatedFacets()
    if mesh.CountFacets < before_facets:
        repairs.append(f"Removed {before_facets - mesh.CountFacets} duplicate facets")

    if mesh.hasSelfIntersections():
        mesh.fixSelfIntersections()
        if not mesh.hasSelfIntersections():
            repairs.append("Fixed self-intersections")

    mesh.fixDegenerations()
    repairs.append("Fixed degenerations")

    if mesh.hasNonManifolds():
        mesh.removeNonManifolds()
        if not mesh.hasNonManifolds():
            repairs.append("Removed non-manifolds")

    mesh.fillupHoles()
    repairs.append("Filled holes")

    mesh.harmonizeNormals()
    repairs.append("Harmonized normals")

    return mesh, repairs


def merge_planar_faces(shape):
    try:
        merged = shape.removeSplitter()
        return merged, True
    except Exception:
        return shape, False


def convert_stl_to_step(input_path, output_path, tolerance=0.01, repair=True, info_only=False):
    result = {
        "success": False,
        "input": input_path,
        "output": output_path,
        "tolerance": tolerance
    }

    try:
        if not os.path.exists(input_path):
            result["error"] = f"Input file not found: {input_path}"
            result["stage"] = "validation"
            safe_exit(result)

        mesh = Mesh.Mesh()
        mesh.read(input_path)

        if mesh.CountFacets == 0:
            result["error"] = "STL file contains no geometry"
            result["stage"] = "read"
            safe_exit(result)

        result["mesh_info_before"] = get_mesh_info(mesh)

        if info_only:
            result["success"] = True
            safe_exit(result)

        if repair:
            mesh, repairs = repair_mesh(mesh)
            result["repairs"] = repairs
            result["mesh_info_after"] = get_mesh_info(mesh)

        doc = FreeCAD.newDocument("STLtoSTEP")

        shape = Part.Shape()
        shape.makeShapeFromMesh(mesh.Topology, tolerance)

        try:
            solid = Part.makeSolid(shape)
            final_shape = solid
            result["is_solid"] = True
        except Exception:
            final_shape = shape
            result["is_solid"] = False

        final_shape, merged_ok = merge_planar_faces(final_shape)
        result["merged_planar_faces"] = merged_ok

        obj = doc.addObject("Part::Feature", "ConvertedMesh")
        obj.Shape = final_shape

        Import.export([obj], output_path)

        if os.path.exists(output_path):
            result["success"] = True
            result["output_size"] = os.path.getsize(output_path)
        else:
            result["error"] = "STEP file was not created"
            result["stage"] = "export"

        FreeCAD.closeDocument("STLtoSTEP")

    except Exception as e:
        result["error"] = str(e)
        result["stage"] = "conversion"

    safe_exit(result)


def main():
    parser = argparse.ArgumentParser(description="Convert STL → STEP")
    parser.add_argument("input")
    parser.add_argument("output")
    parser.add_argument("--tolerance", type=float, default=0.01)
    parser.add_argument("--repair", action="store_true", default=True)
    parser.add_argument("--no-repair", action="store_false", dest="repair")
    parser.add_argument("--info", action="store_true")
    args = parser.parse_args()

    convert_stl_to_step(
        args.input,
        args.output,
        args.tolerance,
        args.repair,
        args.info
    )


if __name__ == "__main__":
    main()
