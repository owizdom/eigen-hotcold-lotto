// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

interface ITEEVerifier {
    /// @notice Returns the trusted enclave signer address
    function trustedEnclave() external view returns (address);

    /// @notice Verify an EIP-191 signed message from the trusted enclave
    /// @param messageHash The keccak256 hash of the packed message
    /// @param signature The ECDSA signature (65 bytes: r, s, v)
    /// @return True if the signature is valid and from the trusted enclave
    function verifySignature(bytes32 messageHash, bytes calldata signature) external view returns (bool);

    /// @notice Verify signature and consume a nonce to prevent replay
    /// @param messageHash The keccak256 hash of the packed message
    /// @param signature The ECDSA signature
    /// @param nonce The monotonic nonce value
    /// @return True if valid signature and nonce not previously used
    function verifyAndConsumeNonce(bytes32 messageHash, bytes calldata signature, uint256 nonce) external returns (bool);
}
