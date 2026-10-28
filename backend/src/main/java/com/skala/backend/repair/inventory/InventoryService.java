package com.skala.backend.repair.inventory;

import com.skala.backend.repair.shared.ApiError;


import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/** Balance changes participate in the order or field-reservation transaction. */
@Service
@Transactional(propagation = Propagation.MANDATORY)
public class InventoryService {
    private final InventoryRepository repository;

    public InventoryService(InventoryRepository repository) {
        this.repository = repository;
    }

    public enum Change { RESERVE, CANCEL, SHIP }

    public void change(Long warehouse, Long part, int quantity, Change change) {
        if (quantity < 1) throw ApiError.bad("QUANTITY");
        repository.lock(warehouse, part);
        int updated = switch (change) {
            case RESERVE -> repository.reserve(warehouse, part, quantity);
            case CANCEL -> repository.cancel(warehouse, part, quantity);
            case SHIP -> repository.ship(warehouse, part, quantity);
        };
        if (updated != 1) throw ApiError.conflict("INSUFFICIENT_STOCK");
    }

    public Long reserveAvailable(Long part, int quantity) {
        if (quantity < 1) throw ApiError.bad("QUANTITY");
        Long warehouse = repository.lockAvailableWarehouse(part, quantity);
        change(warehouse, part, quantity, Change.RESERVE);
        return warehouse;
    }
}
