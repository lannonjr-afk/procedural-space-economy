"""Deterministic procedural planet fields (standard-library reference)."""
from __future__ import annotations

from dataclasses import dataclass
import math

_MASK64 = (1 << 64) - 1


def spatial_hash(seed: int, x: int, y: int, z: int, tag: int = 0) -> int:
    """Stable SplitMix64-style coordinate hash; deterministic, not cryptographic."""
    value = seed & _MASK64
    for part in (x, y, z, tag):
        value ^= (part & _MASK64) + 0x9E3779B97F4A7C15 + ((value << 6) & _MASK64) + (value >> 2)
        value &= _MASK64
        value = (value ^ (value >> 30)) * 0xBF58476D1CE4E5B9 & _MASK64
        value = (value ^ (value >> 27)) * 0x94D049BB133111EB & _MASK64
        value ^= value >> 31
    return value & _MASK64


def _gradient(seed: int, x: int, y: int, z: int) -> tuple[float, float, float]:
    h = spatial_hash(seed, x, y, z)
    # Twelve edge directions of a cube, normalized.
    a, b = ((1.0, 1.0, 0.0), (1.0, 0.0, 1.0), (0.0, 1.0, 1.0))[h % 3]
    return (a if h & 4 else -a, b if h & 8 else -b, 0.0 if h % 3 == 0 else (1.0 if h & 16 else -1.0))


def _fade(t: float) -> float:
    return t * t * t * (t * (t * 6.0 - 15.0) + 10.0)


def noise3(seed: int, x: float, y: float, z: float) -> float:
    """Improved gradient noise approximately in [-1, 1]."""
    ix, iy, iz = math.floor(x), math.floor(y), math.floor(z)
    fx, fy, fz = x - ix, y - iy, z - iz
    u, v, w = _fade(fx), _fade(fy), _fade(fz)
    def lerp(a: float, b: float, t: float) -> float:
        return a + (b - a) * t
    planes: list[float] = []
    for dz in (0, 1):
        rows: list[float] = []
        for dy in (0, 1):
            vals = []
            for dx in (0, 1):
                gx, gy, gz = _gradient(seed, ix + dx, iy + dy, iz + dz)
                vals.append(gx * (fx - dx) + gy * (fy - dy) + gz * (fz - dz))
            rows.append(lerp(vals[0], vals[1], u))
        planes.append(lerp(rows[0], rows[1], v))
    return max(-1.0, min(1.0, lerp(planes[0], planes[1], w) * 1.5))


def fbm(seed: int, x: float, y: float, z: float, *, octaves: int = 5,
        frequency: float = 1.0, lacunarity: float = 2.0, persistence: float = 0.5) -> float:
    if octaves < 1 or frequency <= 0 or lacunarity <= 0 or not 0 < persistence <= 1:
        raise ValueError("invalid fBm parameters")
    total = amplitude_sum = 0.0
    amp, freq = 1.0, frequency
    for octave in range(octaves):
        total += amp * noise3(seed + octave * 0x9E3779B1, x * freq, y * freq, z * freq)
        amplitude_sum += amp
        amp *= persistence
        freq *= lacunarity
    return total / amplitude_sum


@dataclass(frozen=True, slots=True)
class PlanetSpec:
    seed: int
    radius_m: float
    terrain_amplitude_m: float = 2400.0
    sea_level_m: float = 0.0


@dataclass(frozen=True, slots=True)
class TerrainSample:
    elevation_m: float
    signed_distance_m: float
    biome: str
    cave_strength: float


def sample_planet(spec: PlanetSpec, x: float, y: float, z: float) -> TerrainSample:
    """Sample a warped spherical SDF at world-space coordinates."""
    if spec.radius_m <= 0:
        raise ValueError("planet radius must be positive")
    radius = math.sqrt(x*x + y*y + z*z)
    if radius == 0:
        direction = (0.0, 1.0, 0.0)
    else:
        direction = (x / radius, y / radius, z / radius)
    # Warp in normalized planet-space, at distinct frequencies for decorrelated axes.
    scale = 7.0 / spec.radius_m
    wx = fbm(spec.seed + 11, x * scale, y * scale, z * scale, octaves=3)
    wy = fbm(spec.seed + 23, x * scale + 17, y * scale, z * scale, octaves=3)
    wz = fbm(spec.seed + 37, x * scale, y * scale + 31, z * scale, octaves=3)
    warped = (x + wx * 0.035 * spec.radius_m, y + wy * 0.035 * spec.radius_m,
              z + wz * 0.035 * spec.radius_m)
    elevation_noise = fbm(spec.seed, warped[0] * scale, warped[1] * scale, warped[2] * scale,
                          octaves=6, frequency=1.0, lacunarity=2.05, persistence=0.48)
    latitudinal = abs(direction[1])
    elevation = elevation_noise * spec.terrain_amplitude_m + (latitudinal - 0.5) * 350.0
    cave = max(0.0, fbm(spec.seed ^ 0xC0FFEE, x * scale * 2.3, y * scale * 2.3,
                         z * scale * 2.3, octaves=4) - 0.34)
    # Positive is outside solid terrain. Cave subtraction creates isolated void fields.
    surface_sdf = radius - (spec.radius_m + elevation)
    cave_sdf = (0.24 - cave) * 1800.0
    sdf = max(surface_sdf, -cave_sdf)
    if elevation < spec.sea_level_m:
        biome = "ocean"
    elif latitudinal > 0.78:
        biome = "polar"
    elif elevation > spec.terrain_amplitude_m * 0.48:
        biome = "mountain"
    elif elevation_noise < -0.25:
        biome = "arid"
    else:
        biome = "temperate"
    return TerrainSample(elevation, sdf, biome, cave)


def system_parameters(seed: int, sector: tuple[int, int, int], system_index: int) -> dict[str, int | float]:
    """Derive stable example system properties without a database lookup."""
    h = spatial_hash(seed, *sector, tag=system_index)
    return {"star_class": h & 0x7, "planet_count": 1 + ((h >> 3) & 0x7),
            "orbital_period_days": 20.0 + ((h >> 8) & 0xFFFF) / 100.0,
            "resource_grade": ((h >> 24) & 0xFFFF) / 65535.0,
            "ecosystem_id": (h >> 40) & 0xFFFF}
