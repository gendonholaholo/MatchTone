import numpy as np
from numpy.typing import NDArray

METHODS: tuple[str, ...]

class ColorMatcher:
    def __init__(
        self,
        src: NDArray[np.floating] | NDArray[np.uint8] | None = ...,
        ref: NDArray[np.floating] | NDArray[np.uint8] | None = ...,
        method: str = ...,
    ) -> None: ...
    def main(self) -> NDArray[np.float64] | NDArray[np.complex128]: ...
    def transfer(
        self,
        src: NDArray[np.floating] | NDArray[np.uint8] | None = ...,
        ref: NDArray[np.floating] | NDArray[np.uint8] | None = ...,
        method: str | None = ...,
    ) -> NDArray[np.float64] | NDArray[np.complex128]: ...
