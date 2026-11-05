"""Deterministic hierarchical coordinates and procedural star systems."""
from __future__ import annotations

from dataclasses import dataclass
import math

from .terrain import PlanetSpec, spatial_hash, system_parameters


@dataclass(frozen=True, slots=True)
class SectorPosition:
    """Integer sector anchor plus a bounded local offset in meters."""
    sector_x: int
    sector_y: int
    sector_z: int
    local_x: float = 0.0
    local_y: float = 0.0
    local_z: float = 0.0

    def normalized(self, sector_size_m: float = 1_000_000.0) -> "SectorPosition":
        if not math.isfinite(sector_size_m) or sector_size_m <= 0:
            raise ValueError("sector size must be finite and positive")
        coords = [self.sector_x, self.sector_y, self.sector_z]
        local = [self.local_x, self.local_y, self.local_z]
        result_sector: list[int] = []
        result_local: list[float] = []
        for anchor, offset in zip(coords, local, strict=True):
            if not isinstance(anchor, int) or not -(1 << 63) <= anchor < (1 << 63):
                raise ValueError("sector coordinate must fit signed 64-bit integer")
            if not math.isfinite(offset):
                raise ValueError("local coordinate must be finite")
            carry = math.floor(offset / sector_size_m)
            result_sector.append(anchor + carry)
            result_local.append(offset - carry * sector_size_m)
            if not -(1 << 63) <= result_sector[-1] < (1 << 63):
                raise OverflowError("normalized sector coordinate exceeds signed 64-bit range")
        return SectorPosition(*result_sector, *result_local)

    def relative_to(self, origin: "SectorPosition", sector_size_m: float = 1_000_000.0) -> tuple[float, float, float]:
        """Convert only nearby deltas to float; callers must enforce a local range."""
        here, base = self.normalized(sector_size_m), origin.normalized(sector_size_m)
        return tuple((a - b) * sector_size_m + (u - v)
                     for a, b, u, v in zip(
                         (here.sector_x, here.sector_y, here.sector_z),
                         (base.sector_x, base.sector_y, base.sector_z),
                         (here.local_x, here.local_y, here.local_z),
                         (base.local_x, base.local_y, base.local_z), strict=True))


@dataclass(frozen=True, slots=True)
class PlanetDescriptor:
    index: int
    seed: int
    orbital_radius_m: float
    orbital_period_s: float
    radius_m: float
    resource_grade: float
    terrain: PlanetSpec


@dataclass(frozen=True, slots=True)
class StarSystem:
    seed: int
    sector: tuple[int, int, int]
    index: int
    star_class: int
    planets: tuple[PlanetDescriptor, ...]


def generate_system(seed: int, sector: tuple[int, int, int], index: int) -> StarSystem:
    """Purely derive a stable system and planets from seed + integer coordinates."""
    if index < 0:
        raise ValueError("system index must be nonnegative")
    params = system_parameters(seed, sector, index)
    planets: list[PlanetDescriptor] = []
    orbit = 30_000_000.0
    for planet_index in range(int(params["planet_count"])):
        h = spatial_hash(seed, *sector, tag=(index << 16) | planet_index)
        orbit += 25_000_000.0 + ((h >> 8) & 0xFFFF) * 1200.0
        radius = 2_000_000.0 + ((h >> 24) & 0xFFFF) * 120.0
        grade = ((h >> 40) & 0xFFFF) / 65535.0
        planet_seed = spatial_hash(seed, *sector, tag=(index << 24) | planet_index)
        period = 86_400.0 * (20.0 + ((h >> 48) & 0xFFFF) / 100.0)
        planets.append(PlanetDescriptor(
            planet_index, planet_seed, orbit, period, radius, grade,
            PlanetSpec(planet_seed, radius, terrain_amplitude_m=radius * 0.018)))
    return StarSystem(seed, sector, index, int(params["star_class"]), tuple(planets))
