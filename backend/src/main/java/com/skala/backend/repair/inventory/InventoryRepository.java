package com.skala.backend.repair.inventory;

import com.skala.backend.repair.shared.ApiError;
import com.skala.backend.repair.shared.Store;


import org.springframework.stereotype.Repository;

/** PostgreSQL locking and conditional updates for the shared inventory balance. */
@Repository
public class InventoryRepository {
    private final Store db;

    public InventoryRepository(Store db) {
        this.db = db;
    }

    public void lock(Long warehouse, Long part) {
        db.one("SELECT on_hand,reserved FROM inventory WHERE warehouse_id=? AND part_id=? FOR UPDATE", warehouse, part);
    }

    public Long lockAvailableWarehouse(Long part, int quantity) {
        var rows = db.list("SELECT warehouse_id FROM inventory WHERE part_id=? AND on_hand-reserved>=? ORDER BY on_hand-reserved DESC,warehouse_id LIMIT 1 FOR UPDATE", part, quantity);
        if (rows.isEmpty()) throw ApiError.conflict("STOCK_CONFLICT");
        return (Long) rows.getFirst().get("warehouse_id");
    }

    public int reserve(Long warehouse, Long part, int quantity) {
        return db.update("UPDATE inventory SET version=version+1,reserved=reserved+? WHERE warehouse_id=? AND part_id=? AND on_hand-reserved>=?",
                quantity, warehouse, part, quantity);
    }

    public int cancel(Long warehouse, Long part, int quantity) {
        return db.update("UPDATE inventory SET version=version+1,reserved=reserved-? WHERE warehouse_id=? AND part_id=? AND reserved>=?",
                quantity, warehouse, part, quantity);
    }

    public int ship(Long warehouse, Long part, int quantity) {
        return db.update("UPDATE inventory SET version=version+1,on_hand=on_hand-?,reserved=reserved-? WHERE warehouse_id=? AND part_id=? AND reserved>=? AND on_hand>=?",
                quantity, quantity, warehouse, part, quantity, quantity);
    }
}
