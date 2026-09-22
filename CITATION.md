# Citation

This project is a fork of the [Ray Optics Simulation](https://github.com/ricktu288/ray-optics) and
still contains its ray tracer. Which work to cite therefore depends on which part you used.

## The wave optics simulator, or the assignments

Cite [the Zenodo record](https://doi.org/10.5281/zenodo.22893112),
`10.5281/zenodo.22893112`. That is the *concept* DOI: it resolves to the most recent release, which
is what a reader following the citation almost always wants. Each release also has a DOI of its own,
shown on its Zenodo page, for when the exact version matters.

[`CITATION.cff`](CITATION.cff) in the repository root holds the same metadata in machine-readable
form; GitHub renders it as a "Cite this repository" button, and most reference managers read it
directly.

## The ray optics simulator

The ray tracer is the original project's work, not this one's. Cite
[the Zenodo record of the Ray Optics Simulation](https://doi.org/10.5281/zenodo.6386611), following
the "Citation" or "Export" panel there.

If you used the ray tracer *through* this fork — for instance because you used an assignment built
on it — cite both: the original for the simulation, this project for what was done with it.

## Both

A paper that uses the wave simulator and the ray simulator together should cite both records. The
`references` section of `CITATION.cff` names the original, so a manager that follows references will
usually offer both.
