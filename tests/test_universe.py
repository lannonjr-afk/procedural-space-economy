import unittest

from spacegame.universe import SectorPosition, generate_system


class UniverseTests(unittest.TestCase):
    def test_local_coordinates_carry_across_sectors(self) -> None:
        position = SectorPosition(4, -2, 0, 1_250_000, -1_000_001, 12).normalized()
        self.assertEqual((position.sector_x, position.sector_y, position.sector_z), (5, -4, 0))
        self.assertAlmostEqual(position.local_x, 250_000)
        self.assertAlmostEqual(position.local_y, 999_999)
        self.assertAlmostEqual(position.local_z, 12)

    def test_relative_coordinates_use_sector_delta(self) -> None:
        origin = SectorPosition(10, 0, 0, 0, 0, 0)
        nearby = SectorPosition(10, 0, 0, 25, -5, 8)
        self.assertEqual(nearby.relative_to(origin), (25, -5, 8))

    def test_system_generation_is_deterministic(self) -> None:
        a = generate_system(123, (4, -8, 1), 2)
        b = generate_system(123, (4, -8, 1), 2)
        self.assertEqual(a, b)
        self.assertGreaterEqual(len(a.planets), 1)
        self.assertTrue(all(planet.radius_m > 0 for planet in a.planets))

    def test_different_sectors_generate_different_systems(self) -> None:
        self.assertNotEqual(generate_system(123, (0, 0, 0), 0), generate_system(123, (1, 0, 0), 0))


if __name__ == "__main__":
    unittest.main()
