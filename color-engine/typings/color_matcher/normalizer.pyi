import numpy as np
from numpy.typing import ArrayLike, NDArray

class Normalizer:
    def __init__(
        self,
        data: ArrayLike | None = ...,
        min: float | None = ...,
        max: float | None = ...,
    ) -> None: ...
    def uint16_norm(self) -> NDArray[np.uint16]: ...
    def uint8_norm(self) -> NDArray[np.uint8]: ...
    def type_norm(
        self,
        data: ArrayLike | None = ...,
        min: float | None = ...,
        max: float | None = ...,
        new_min: float | None = ...,
        new_max: float | None = ...,
    ) -> NDArray[np.float64]: ...
    def norm_fun(self) -> NDArray[np.float64]: ...
