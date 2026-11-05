"""Small reference models for fixed-tick reconciliation and 3D AOI."""
from __future__ import annotations

from dataclasses import dataclass, field
import math
from typing import Generic, TypeVar


@dataclass(frozen=True, slots=True)
class Vec3:
    x: float
    y: float
    z: float

    def __add__(self, other: "Vec3") -> "Vec3":
        return Vec3(self.x + other.x, self.y + other.y, self.z + other.z)


@dataclass(frozen=True, slots=True)
class InputFrame:
    sequence: int
    acceleration: Vec3
    dt: float


@dataclass(slots=True)
class CraftState:
    position: Vec3
    velocity: Vec3
    acknowledged_sequence: int = -1


def simulate(state: CraftState, frame: InputFrame) -> CraftState:
    if not 0 < frame.dt <= 0.1:
        raise ValueError("dt outside supported tick range")
    velocity = state.velocity + Vec3(frame.acceleration.x * frame.dt,
                                     frame.acceleration.y * frame.dt,
                                     frame.acceleration.z * frame.dt)
    return CraftState(state.position + Vec3(velocity.x * frame.dt, velocity.y * frame.dt,
                                           velocity.z * frame.dt), velocity, frame.sequence)


def reconcile(authoritative: CraftState, pending: list[InputFrame]) -> CraftState:
    """Reset to server state then replay inputs newer than its acknowledged sequence."""
    state = authoritative
    for frame in pending:
        if frame.sequence > authoritative.acknowledged_sequence:
            state = simulate(state, frame)
    return state


Cell = tuple[int, int, int]
T = TypeVar("T")


@dataclass
class AOIGrid(Generic[T]):
    cell_size: float
    subscribers: dict[Cell, set[T]] = field(default_factory=dict)
    client_cells: dict[T, set[Cell]] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if self.cell_size <= 0:
            raise ValueError("cell size must be positive")

    def cells_for_sphere(self, center: Vec3, radius: float) -> set[Cell]:
        if radius < 0:
            raise ValueError("radius must be nonnegative")
        lo = [math.floor((c - radius) / self.cell_size) for c in (center.x, center.y, center.z)]
        hi = [math.floor((c + radius) / self.cell_size) for c in (center.x, center.y, center.z)]
        return {(x, y, z) for x in range(lo[0], hi[0] + 1)
                for y in range(lo[1], hi[1] + 1) for z in range(lo[2], hi[2] + 1)}

    def subscribe(self, client: T, center: Vec3, radius: float) -> None:
        self.unsubscribe(client)
        cells = self.cells_for_sphere(center, radius)
        self.client_cells[client] = cells
        for cell in cells:
            self.subscribers.setdefault(cell, set()).add(client)

    def unsubscribe(self, client: T) -> None:
        for cell in self.client_cells.pop(client, set()):
            members = self.subscribers.get(cell)
            if members is not None:
                members.discard(client)
                if not members:
                    del self.subscribers[cell]

    def recipients(self, cells: set[Cell], *, exclude: T | None = None) -> set[T]:
        result: set[T] = set()
        for cell in cells:
            result.update(self.subscribers.get(cell, ()))
        if exclude is not None:
            result.discard(exclude)
        return result
