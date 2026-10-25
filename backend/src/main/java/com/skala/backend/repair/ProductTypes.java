package com.skala.backend.repair;

import java.util.*;

/** PR #6 wire vocabulary. No inference from model names, symptoms or AI results. */
public final class ProductTypes {
    private ProductTypes() {}
    public static String canonical(Object value) {
        if(!(value instanceof String s))return "unknown";
        String normalized=s.trim().toLowerCase(Locale.ROOT);
        return Set.of("vacuum","washing_machine","air_conditioner","unknown").contains(normalized)?normalized:"unknown";
    }
    public static String fromAppliance(Object value) {
        if(!(value instanceof String s))return "unknown";
        return switch(s.trim().toUpperCase(Locale.ROOT)) {
            case "VACUUM_CLEANER","VACUUM" -> "vacuum";
            case "WASHING_MACHINE" -> "washing_machine";
            case "AIR_CONDITIONER" -> "air_conditioner";
            default -> "unknown";
        };
    }
    /** Expose consistent aliases without modifying the stored original snapshot. */
    static Map<String,Object> wireRepair(Map<String,Object> repair) {
        String type=canonical(repair.get("product_type"));
        var snapshot=new LinkedHashMap<String,Object>();
        if(repair.get("product_snapshot") instanceof Map<?,?> original)
            original.forEach((key,value)->snapshot.put(key.toString(),value));
        snapshot.put("product_type",type);
        if(snapshot.containsKey("productType"))snapshot.put("productType",type);
        repair.put("product_type",type);repair.put("product_snapshot",snapshot);return repair;
    }
}
