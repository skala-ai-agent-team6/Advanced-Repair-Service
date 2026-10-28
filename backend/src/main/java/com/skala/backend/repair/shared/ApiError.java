package com.skala.backend.repair.shared;

import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import org.springframework.dao.*;

public class ApiError extends RuntimeException {
    final int status;
    final String code;
    public String code() { return code; }
    public int status() { return status; }
    public ApiError(int status, String code) { super(code); this.status=status; this.code=code; }
    public static ApiError bad(String code) { return new ApiError(400,code); }
    public static ApiError conflict(String code) { return new ApiError(409,code); }
    public static ApiError missing() { return new ApiError(404,"NOT_FOUND"); }
    public static ApiError denied() { return new ApiError(403,"FORBIDDEN"); }
}
