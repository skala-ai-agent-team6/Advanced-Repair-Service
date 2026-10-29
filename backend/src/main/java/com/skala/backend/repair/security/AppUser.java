package com.skala.backend.repair.security;

import jakarta.persistence.*;

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
    public Long id() { return id; }
    public String email() { return email; }
    public String name() { return name; }
    public String role() { return role; }
    public Long centerId() { return centerId; }
    public boolean active() { return active; }
    public boolean operationsEnabled() { return operationsEnabled; }
    public String technicianType() { return technicianType; }
    protected AppUser() {}
}
