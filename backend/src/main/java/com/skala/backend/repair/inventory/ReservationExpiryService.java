package com.skala.backend.repair.inventory;

import com.skala.backend.repair.shared.Json;
import com.skala.backend.repair.shared.Store;


import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/** Expires reservations independently of GET requests and also before stock commands. */
@Service
public class ReservationExpiryService {
    private final Store db;
    private final InventoryService inventory;
    private final TransactionTemplate tx;

    public ReservationExpiryService(Store db, InventoryService inventory, PlatformTransactionManager manager) {
        this.db = db;
        this.inventory = inventory;
        this.tx = new TransactionTemplate(manager);
    }

    @Scheduled(fixedDelayString = "${app.inventory.expiry-delay:30000}")
    public void expireDue() {
        tx.executeWithoutResult(status -> {
            var rows = db.list("SELECT * FROM stock_reservation WHERE status='RESERVED' AND expires_at<now() ORDER BY warehouse_id,part_id,id FOR UPDATE SKIP LOCKED");
            for (var row : rows) {
                int quantity = Json.number(row.get("quantity"));
                inventory.change((Long) row.get("warehouse_id"), (Long) row.get("part_id"), quantity,
                        InventoryService.Change.CANCEL);
                db.update("UPDATE stock_reservation SET status='EXPIRED',closed_at=now() WHERE id=?", row.get("id"));
                db.update("INSERT INTO stock_history(reservation_id,part_id,warehouse_id,case_id,change,delta,quantity,actor_id) VALUES (?,?,?,?,'EXPIRE',?,?,NULL)",
                        row.get("id"), row.get("part_id"), row.get("warehouse_id"), row.get("case_id"), quantity, quantity);
            }
        });
    }
}
