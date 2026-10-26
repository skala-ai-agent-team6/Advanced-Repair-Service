package com.skala.backend.repair;

import jakarta.persistence.*;
import java.util.UUID;

@Entity
@Table(name="app_user")
public class AppUser {
    @Id Long id;
    String email;
    String name;
    boolean active;
    @Column(name="password_hash") String passwordHash;
    String role;
    @Column(name="operations_enabled") boolean operationsEnabled;
    @Column(name="center_id") Long centerId;
    @Column(name="technician_type") String technicianType;  // CENTER | FIELD (V10)
    protected AppUser() {}
}
